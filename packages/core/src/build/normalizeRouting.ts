import type { NextAdapterRouting } from "../types/adapter.js";

/**
 * A route of `NextAdapterRouting`, with the fields Next emits on top of what the resolver reads.
 */
type AdapterRoute = NextAdapterRouting["beforeMiddleware"][number] & {
	source?: string;
	priority?: boolean;
};

type CustomRouteGroup = "beforeMiddleware" | "beforeFiles" | "afterFiles" | "fallback";

const CUSTOM_ROUTE_GROUPS: CustomRouteGroup[] = ["beforeMiddleware", "beforeFiles", "afterFiles", "fallback"];

/** The locale capture Next prefixes localized dynamic routes with. */
const LOCALE_CAPTURE = "(?<nextLocale>[^/]{1,})";

export type NormalizeRoutingOptions = {
	/** The configured locales, empty when `i18n` is not configured. */
	locales: string[];
	/** The pathnames of the pages router API routes. */
	apiPathnames: Set<string>;
};

function isExternalDestination(destination: string): boolean {
	return destination.startsWith("http://") || destination.startsWith("https://");
}

function splitDestination(destination: string): [pathname: string, search: string] {
	const separator = destination.indexOf("?");
	return separator === -1
		? [destination, ""]
		: [destination.slice(0, separator), destination.slice(separator)];
}

function isRedirect(route: AdapterRoute): boolean {
	return (
		route.status !== undefined &&
		route.status >= 300 &&
		route.status < 400 &&
		Object.keys(route.headers ?? {}).some((key) => key.toLowerCase() === "location")
	);
}

/**
 * Whether the route is one Next already emitted for a locale.
 *
 * Next prefixes the source of every route it localizes, either with the locale group
 * (`/:nextInternalLocale(en|nl)/...`) or with a concrete locale for the default locale variant.
 * A route declared with `locale: false` keeps its source as authored.
 */
function isLocalized(route: AdapterRoute, locales: string[]): boolean {
	const source = route.source ?? "";
	return (
		source.startsWith("/:nextInternalLocale") ||
		locales.some((locale) => source === `/${locale}` || source.startsWith(`/${locale}/`))
	);
}

/**
 * Drops the locale a destination targeting a pages router API route carries.
 *
 * Next localizes every destination when `i18n` is configured, but never emits a localized output
 * for an API route - and the resolver never localizes an `/api/` request either. The locale would
 * only make the destination unresolvable, so it is stripped.
 */
function delocalizeApiDestination(destination: string, apiPathnames: Set<string>): string {
	const [pathname, search] = splitDestination(destination);
	// The locale of a destination is a capture reference - `/$1/api/query` or `/$nextLocale/api/foo`.
	const localePrefix = pathname.match(/^\/\$\w+(?<rest>\/.*)$/);
	const rest = localePrefix?.groups?.["rest"];
	return rest !== undefined && apiPathnames.has(rest) ? `${rest}${search}` : destination;
}

/**
 * Prefixes an internal destination with a locale.
 *
 * API routes are the exception - see `delocalizeApiDestination`.
 */
function localizeDestination(destination: string, locale: string, apiPathnames: Set<string>): string {
	if (isExternalDestination(destination)) {
		return destination;
	}
	const [pathname, search] = splitDestination(destination);
	if (apiPathnames.has(pathname)) {
		return destination;
	}
	// `/` is the pathname of the locale root itself, i.e. `/en` and not `/en/`.
	return `/${locale}${pathname === "/" ? "" : pathname}${search}`;
}

/**
 * Creates the variant of a route matching the pathname of a locale.
 *
 * The resolver prefixes the pathname of the request with the detected locale before matching any
 * route, so a route Next did not localize - i.e. one declared with `locale: false` - would never
 * match. The variants restore the routes for every locale the request may have been resolved to.
 */
function localizeRoute(route: AdapterRoute, locale: string, apiPathnames: Set<string>): AdapterRoute {
	return {
		...route,
		source: route.source === undefined ? undefined : `/${locale}${route.source}`,
		sourceRegex: route.sourceRegex.replace(/^\^/, `^\\/${locale}`),
		destination:
			route.destination === undefined
				? undefined
				: localizeDestination(route.destination, locale, apiPathnames),
	};
}

/**
 * Turns a redirect into a route the resolver stops at.
 *
 * The resolver only stops processing a group when the matched route has a destination, so a
 * redirect - which carries its target in a `location` header - lets every route after it match and
 * override that header. Next stops at the first matching redirect, and so must we: the destination
 * makes the resolver return the redirect right away.
 */
function withRedirectDestination(route: AdapterRoute): AdapterRoute {
	const location = Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === "location")?.[1];
	return location === undefined ? route : { ...route, destination: location };
}

/**
 * The name of the capture group spanning the whole condition value, if there is one.
 *
 * `(?<destination>\w+)` captures the value as a whole, `foo-(?<id>\d+)` only a part of it.
 */
function wholeValueCaptureName(value: string): string | undefined {
	const match = value.match(/^\(\?<(?<name>\w+)>(?<body>.*)\)$/s);
	const body = match?.groups?.["body"];
	if (body === undefined) {
		return undefined;
	}
	// The group only spans the whole value when its opening parenthesis is the one closing at the end.
	let depth = 0;
	for (let index = 0; index < body.length; index++) {
		const character = body[index];
		if (character === "\\") {
			index++;
		} else if (character === "(") {
			depth++;
		} else if (character === ")" && depth-- === 0) {
			return undefined;
		}
	}
	return depth === 0 ? match?.groups?.["name"] : undefined;
}

/**
 * Renames the capture references of the `has` conditions of a route to the names the resolver binds.
 *
 * Next names them after the capture group of the condition value - `$destination` for a
 * `(?<destination>\w+)` query condition - while the resolver binds the value it matched to the key
 * of the condition instead. Only a group spanning the whole value can be renamed: it is the one
 * case where both are the same string.
 */
function alignHasCaptures(route: AdapterRoute): AdapterRoute {
	const renames = (route.has ?? []).flatMap((condition) => {
		// A `host` condition matches on the hostname and binds no capture.
		if (condition.type === "host" || condition.value === undefined) {
			return [];
		}
		const name = wholeValueCaptureName(condition.value);
		// The resolver strips everything but the letters of the key it binds the value to.
		const boundName = condition.key.replace(/[^a-zA-Z]/g, "");
		return name === undefined || name === boundName ? [] : [[name, boundName] as const];
	});
	if (renames.length === 0) {
		return route;
	}
	const rename = (value: string) =>
		renames.reduce((current, [name, boundName]) => current.replaceAll(`$${name}`, `$${boundName}`), value);
	return {
		...route,
		destination: route.destination === undefined ? undefined : rename(route.destination),
		headers:
			route.headers === undefined
				? undefined
				: Object.fromEntries(Object.entries(route.headers).map(([key, value]) => [key, rename(value)])),
	};
}

/**
 * Drops the locale Next prefixed a pages router API dynamic route with.
 *
 * The resolver leaves `/api/` requests unlocalized, so the locale capture would keep the route from
 * ever matching one.
 */
function delocalizeApiDynamicRoute(route: AdapterRoute, apiPathnames: Set<string>): AdapterRoute {
	if (!route.source || !apiPathnames.has(route.source) || !route.sourceRegex.includes(LOCALE_CAPTURE)) {
		return route;
	}
	return {
		...route,
		sourceRegex: route.sourceRegex.replace(LOCALE_CAPTURE, ""),
		destination: route.destination?.replace("/$nextLocale", ""),
	};
}

/**
 * Reconciles the routing Next emits with the pathnames the resolver actually matches.
 *
 * Next assumes a router that localizes every request and stops at the first matching redirect,
 * neither of which the resolver does. This rewrites the routes so that both agree.
 */
export function normalizeRouting(
	routing: NextAdapterRouting,
	{ locales, apiPathnames }: NormalizeRoutingOptions
): NextAdapterRouting {
	const normalized: NextAdapterRouting = {
		...routing,
		dynamicRoutes: routing.dynamicRoutes.map((route) =>
			delocalizeApiDynamicRoute(route as AdapterRoute, apiPathnames)
		),
	};

	for (const group of CUSTOM_ROUTE_GROUPS) {
		normalized[group] = (routing[group] as AdapterRoute[]).flatMap((originalRoute) => {
			const route = alignHasCaptures(originalRoute);
			const withApiDestination: AdapterRoute =
				route.destination === undefined
					? route
					: { ...route, destination: delocalizeApiDestination(route.destination, apiPathnames) };
			// A priority route is matched against the request as it came in - i.e. before the resolver
			// localizes it - so it needs no variant.
			const variants =
				locales.length === 0 || route.priority || isLocalized(route, locales)
					? []
					: locales.map((locale) => localizeRoute(withApiDestination, locale, apiPathnames));
			return [...variants, withApiDestination].map((variant) =>
				!variant.priority && isRedirect(variant) && variant.destination === undefined
					? withRedirectDestination(variant)
					: variant
			);
		});
	}

	return normalized;
}
