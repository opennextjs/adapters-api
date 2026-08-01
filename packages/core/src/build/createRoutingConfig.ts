import fs from "node:fs";
import path from "node:path";

import type { RuntimeRoutingConfig } from "../types/adapter.js";

import type { BuildCompleteContext } from "./adapter.js";
import type * as buildHelper from "./helper.js";

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

	// Prerender outputs are emitted both for the concrete pathname of every prerendered route and
	// for the template pathname of every dynamic route with `getStaticPaths`/`generateStaticParams`.
	// Only some of them match an executable route: the prerendered non dynamic routes and the
	// dynamic templates - a request for a concrete path of a dynamic route resolves to its template.
	// The remaining ones (concrete paths of dynamic routes, `.rsc` and `_next/data` variants) have
	// no entry in the index and are simply ignored here.
	for (const prerender of context.outputs.prerenders ?? []) {
		const route = routeIndex[prerender.pathname];
		if (route) {
			route.isISR = true;
		}
	}

	const outputPathnames = PATHNAME_OUTPUT_TYPES.flatMap((outputType) =>
		(context.outputs[outputType] ?? []).map((output) => output.pathname)
	);
	const pathnames = context.config.trailingSlash
		? withTrailingSlashVariants(outputPathnames)
		: outputPathnames;
	const routingConfig: RuntimeRoutingConfig = {
		buildId: context.buildId,
		routes: context.routing,
		pathnames,
		routeIndex,
	};

	const routingConfigPath = path.join(options.appBuildOutputPath, ".next", "open-next-routing.json");
	fs.writeFileSync(routingConfigPath, JSON.stringify(routingConfig));

	return routingConfig;
}
