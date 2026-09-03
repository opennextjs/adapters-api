import type { NextAdapterRouting } from "@/types/adapter";

type ResolverRoute = NextAdapterRouting["beforeMiddleware"][number];
type RouteCondition = NonNullable<ResolverRoute["has"]>[number];

/**
 * A route Next applies to the request as it came in.
 *
 * Next flags its internal canonicalizing redirects - the ones adding or stripping the trailing
 * slash - as `priority` because it matches them before normalizing the request: before the
 * `/_next/data/` pathname is rewritten to the page it carries and before the locale is resolved.
 * The resolver knows no such phase and runs them with the rest of `beforeMiddleware`, i.e. against
 * an already normalized pathname, which redirects every data request to its page.
 */
type PriorityRoute = ResolverRoute & { priority?: boolean };

/**
 * A priority route we take over from the resolver.
 *
 * Only the redirects are: they are matched and applied here, on the incoming request. A priority
 * route with a destination is a rewrite, which we have no reason to hoist out of the resolver.
 */
function isPriorityRedirect(route: PriorityRoute): boolean {
	return Boolean(route.priority) && route.destination === undefined;
}

function getConditionValue(condition: RouteCondition, url: URL, headers: Headers): string | undefined {
	switch (condition.type) {
		case "header":
			return headers.get(condition.key) ?? undefined;
		case "cookie":
			return headers
				.get("cookie")
				?.split(";")
				.map((cookie) => cookie.trim().split("="))
				.find(([key]) => key === condition.key)
				?.slice(1)
				.join("=");
		case "query":
			return url.searchParams.get(condition.key) ?? undefined;
		case "host":
			return url.hostname;
	}
}

function matchesCondition(value: string | undefined, expected?: string): boolean {
	if (value === undefined) {
		return false;
	}
	if (expected === undefined) {
		return true;
	}
	try {
		if (new RegExp(expected).test(value)) {
			return true;
		}
	} catch {
		// An unparsable condition falls back to an exact comparison, as the resolver does.
	}
	return value === expected;
}

function matchesConditions(route: PriorityRoute, url: URL, headers: Headers): boolean {
	const has = route.has?.every((condition) =>
		matchesCondition(getConditionValue(condition, url, headers), condition.value)
	);
	const missing = route.missing?.every(
		(condition) => !matchesCondition(getConditionValue(condition, url, headers), condition.value)
	);
	return (has ?? true) && (missing ?? true);
}

/**
 * Splits the routes Next matches against the incoming request off the ones the resolver runs.
 */
export function splitPriorityRoutes(routes: NextAdapterRouting): {
	priorityRoutes: PriorityRoute[];
	resolverRoutes: NextAdapterRouting;
} {
	const priorityRoutes = routes.beforeMiddleware.filter(isPriorityRedirect);
	if (priorityRoutes.length === 0) {
		return { priorityRoutes, resolverRoutes: routes };
	}
	return {
		priorityRoutes,
		resolverRoutes: {
			...routes,
			beforeMiddleware: routes.beforeMiddleware.filter((route) => !isPriorityRedirect(route)),
		},
	};
}

/**
 * Resolves the redirect the priority routes produce for the request, if any.
 */
export function resolvePriorityRedirect(
	priorityRoutes: PriorityRoute[],
	url: URL,
	requestHeaders: Headers
): { status: number; headers: Headers } | undefined {
	for (const route of priorityRoutes) {
		const match = url.pathname.match(new RegExp(route.sourceRegex));
		if (!match || !matchesConditions(route, url, requestHeaders)) {
			continue;
		}
		const headers = new Headers();
		for (const [key, value] of Object.entries(route.headers ?? {})) {
			headers.set(
				key,
				value.replace(/\$(\d+)/g, (placeholder, index) => match[Number(index)] ?? placeholder)
			);
		}
		const status = route.status;
		const location = headers.get("location");
		if (location && status && status >= 300 && status < 400) {
			// The captures come from the pathname only, so the query of the request has to be carried over.
			// The location stays relative to avoid treating a `//host` pathname as another origin.
			if (url.search && !location.includes("?")) {
				headers.set("location", `${location}${url.search}`);
			}
			return { status, headers };
		}
	}
	return undefined;
}
