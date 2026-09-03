import fs from "node:fs";
import path from "node:path";

import type { RuntimeRoutingConfig } from "../types/adapter.js";

import type { BuildCompleteContext } from "./adapter.js";
import type * as buildHelper from "./helper.js";
import { normalizeRouting } from "./normalizeRouting.js";

const EXECUTABLE_OUTPUT_TYPES = ["pages", "pagesApi", "appPages", "appRoutes"] as const;
const PATHNAME_OUTPUT_TYPES = [...EXECUTABLE_OUTPUT_TYPES, "staticFiles"] as const;

// Matches the pathnames Next considers to be files - i.e. whose last segment has an extension.
const FILE_PATHNAME_REGEX = /\.\w+$/;

/**
 * Adds the trailing slash variant of every pathname that Next canonicalizes with a trailing slash.
 *
 * The resolver matches pathnames by strict equality and has no notion of `trailingSlash`, so with
 * the option enabled it would never match a request - they all carry a trailing slash. Both forms
 * are needed: the slash free one is the one matching while the canonicalizing redirect is emitted.
 */
function withTrailingSlashVariants(pathnames: string[]): string[] {
	return pathnames.flatMap((pathname) =>
		// Files are canonicalized the other way around - their trailing slash is stripped.
		pathname.endsWith("/") || FILE_PATHNAME_REGEX.test(pathname) ? [pathname] : [pathname, `${pathname}/`]
	);
}

/**
 * Applies the captures of a `sourceRegex` match to the destination of a route.
 *
 * Mirrors the substitution the resolver performs at runtime.
 */
function applyCaptures(destination: string, match: RegExpMatchArray): string {
	let resolved = destination;
	for (let index = 1; index < match.length; index++) {
		if (match[index] !== undefined) {
			resolved = resolved.replaceAll(`$${index}`, match[index]);
		}
	}
	for (const [name, value] of Object.entries(match.groups ?? {})) {
		if (value !== undefined) {
			resolved = resolved.replaceAll(`$${name}`, value);
		}
	}
	return resolved;
}

/**
 * Creates the resolver of the executable route serving a prerendered pathname.
 *
 * Prerender outputs are emitted for the concrete pathname of every prerendered route
 * (`/blog/hello`), for the template pathname of every dynamic route with `getStaticPaths`/
 * `generateStaticParams` (`/blog/[slug]`) and for the data variants of both. Only the templates are
 * executable, so a concrete pathname has to be routed back to the template regenerating it when its
 * cache entry is missing or stale.
 */
function createPrerenderRouteResolver(context: BuildCompleteContext, executableRoutes: Set<string>) {
	const basePath = context.config.basePath ?? "";
	const dataPrefix = `${basePath}/_next/data/${context.buildId}/`;
	const executableRouteById = new Map(
		EXECUTABLE_OUTPUT_TYPES.flatMap((outputType) =>
			context.outputs[outputType].map((output) => [output.id, output.pathname] as const)
		)
	);
	const dynamicRoutes = context.routing.dynamicRoutes.map((route) => ({
		regex: new RegExp(route.sourceRegex),
		destination: route.destination,
	}));

	/**
	 * The executable destination of the highest priority dynamic route matching the pathname.
	 *
	 * Only the first match is considered: a lower priority route is not the one Next would have used,
	 * even when the higher priority one has no executable destination. The `has`/`missing` conditions
	 * are ignored - they gate draft mode, not which route owns the pathname.
	 */
	function matchDynamicRoute(pathname: string): string | undefined {
		for (const { regex, destination } of dynamicRoutes) {
			const match = pathname.match(regex);
			if (!match) {
				continue;
			}
			if (!destination) {
				return undefined;
			}
			const [target] = applyCaptures(destination, match).split("?");
			return executableRoutes.has(target) ? target : undefined;
		}
		return undefined;
	}

	return function resolvePrerenderRoute({
		pathname,
		parentOutputId,
	}: NonNullable<BuildCompleteContext["outputs"]["prerenders"]>[number]): string | undefined {
		const parentRoute = executableRouteById.get(parentOutputId);
		if (parentRoute) {
			return parentRoute;
		}
		if (executableRoutes.has(pathname)) {
			return pathname;
		}
		const dynamicRoute = matchDynamicRoute(pathname);
		if (dynamicRoute) {
			return dynamicRoute;
		}
		// The data variant of a prerendered pages router route has no output of its own - it is served
		// by the route itself, which Next reaches by normalizing the `/_next/data/` pathname.
		if (!pathname.startsWith(dataPrefix) || !pathname.endsWith(".json")) {
			return undefined;
		}
		const normalized = `${basePath}/${pathname.slice(dataPrefix.length, -".json".length)}`;
		return executableRoutes.has(normalized) ? normalized : matchDynamicRoute(normalized);
	};
}

/**
 * Generates the runtime route index consumed by every provider bundle.
 *
 * @param options Normalized OpenNext build options.
 * @param context Routing and output metadata emitted by Next.js.
 * @returns The serialized runtime routing configuration.
 */
export function createRoutingConfig(
	options: buildHelper.BuildOptions,
	context: BuildCompleteContext
): RuntimeRoutingConfig {
	const routeIndex: RuntimeRoutingConfig["routeIndex"] = {};

	for (const outputType of EXECUTABLE_OUTPUT_TYPES) {
		for (const output of context.outputs[outputType]) {
			routeIndex[output.pathname] = {
				type: outputType === "appPages" ? "app" : outputType === "appRoutes" ? "route" : "page",
				isFallback: false,
				isISR: false,
			};
		}
	}

	// The set has to be snapshotted before the prerendered pathnames are indexed - they are servable
	// but not executable, and may never be the resolution target of another prerendered pathname.
	const executableRoutes = new Set(Object.keys(routeIndex));
	const resolvePrerenderRoute = createPrerenderRouteResolver(context, executableRoutes);
	const prerenderPathnames: string[] = [];

	for (const prerender of context.outputs.prerenders ?? []) {
		const route = resolvePrerenderRoute(prerender);
		if (!route) {
			// Artifacts no route can regenerate - i.e. the PPR segment prefetches - are served from the
			// cache only and are left out of the index.
			continue;
		}
		routeIndex[route].isISR = true;
		if (route !== prerender.pathname) {
			routeIndex[prerender.pathname] = { ...routeIndex[route], route };
			prerenderPathnames.push(prerender.pathname);
		}
	}

	const outputPathnames = PATHNAME_OUTPUT_TYPES.flatMap((outputType) =>
		(context.outputs[outputType] ?? []).map((output) => output.pathname)
	);
	const servablePathnames = [...outputPathnames, ...prerenderPathnames];
	const pathnames = [
		...new Set(
			context.config.trailingSlash ? withTrailingSlashVariants(servablePathnames) : servablePathnames
		),
	];
	const routingConfig: RuntimeRoutingConfig = {
		buildId: context.buildId,
		routes: normalizeRouting(context.routing, {
			locales: context.config.i18n?.locales ?? [],
			apiPathnames: new Set(context.outputs.pagesApi.map((output) => output.pathname)),
		}),
		pathnames,
		routeIndex,
	};

	const routingConfigPath = path.join(options.appBuildOutputPath, ".next", "open-next-routing.json");
	fs.writeFileSync(routingConfigPath, JSON.stringify(routingConfig));

	return routingConfig;
}
