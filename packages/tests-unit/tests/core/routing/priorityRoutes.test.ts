import {
	resolvePriorityRedirect,
	splitPriorityRoutes,
} from "@opennextjs/core/core/routing/priorityRoutes.js";
import type { NextAdapterRouting } from "@opennextjs/core/types/adapter.js";

const ADD_TRAILING_SLASH = {
	sourceRegex: String.raw`^(?:\/((?:[^/]+\/)*[^/\.]+))$`,
	headers: { Location: "/$1/" },
	status: 308,
	priority: true,
};

const STRIP_TRAILING_SLASH = {
	sourceRegex: String.raw`^(?:\/((?:[^/]+\/)*[^/]+\.\w+))\/$`,
	headers: { Location: "/$1" },
	status: 308,
	missing: [{ type: "header" as const, key: "x-nextjs-data" }],
	priority: true,
};

function routing(beforeMiddleware: unknown[]): NextAdapterRouting {
	return {
		beforeMiddleware,
		beforeFiles: [],
		afterFiles: [],
		dynamicRoutes: [],
		onMatch: [],
		fallback: [],
	} as unknown as NextAdapterRouting;
}

function resolve(routes: unknown[], target: string, headers: Record<string, string> = {}) {
	const url = new URL(`https://localhost${target}`);
	return resolvePriorityRedirect(routes as never, url, new Headers(headers));
}

describe("splitPriorityRoutes", () => {
	it("takes the priority redirects out of the routes handed to the resolver", () => {
		const redirect = { sourceRegex: "^/old$", headers: { Location: "/new" }, status: 308 };
		const routes = routing([ADD_TRAILING_SLASH, redirect]);

		const { priorityRoutes, resolverRoutes } = splitPriorityRoutes(routes);

		expect(priorityRoutes).toEqual([ADD_TRAILING_SLASH]);
		expect(resolverRoutes.beforeMiddleware).toEqual([redirect]);
	});

	it("leaves a priority route that rewrites to the resolver", () => {
		const rewrite = { sourceRegex: "^/old$", destination: "/new", priority: true };
		const routes = routing([rewrite]);

		const { priorityRoutes, resolverRoutes } = splitPriorityRoutes(routes);

		expect(priorityRoutes).toEqual([]);
		expect(resolverRoutes).toBe(routes);
	});

	it("keeps the routes untouched when there is no priority route", () => {
		const routes = routing([{ sourceRegex: "^/old$", headers: { Location: "/new" }, status: 308 }]);

		expect(splitPriorityRoutes(routes).resolverRoutes).toBe(routes);
	});
});

describe("resolvePriorityRedirect", () => {
	it("substitutes the captures of the pathname into the location", () => {
		expect(resolve([ADD_TRAILING_SLASH], "/blog/hello")).toMatchObject({
			status: 308,
		});
		expect(resolve([ADD_TRAILING_SLASH], "/blog/hello")?.headers.get("location")).toBe("/blog/hello/");
	});

	it("carries the query of the request over to the location", () => {
		expect(resolve([ADD_TRAILING_SLASH], "/blog?happy=true")?.headers.get("location")).toBe(
			"/blog/?happy=true"
		);
	});

	it("does not match a pathname already in its canonical form", () => {
		expect(resolve([ADD_TRAILING_SLASH], "/blog/")).toBeUndefined();
	});

	it("does not match a pathname that would resolve to another origin", () => {
		expect(resolve([STRIP_TRAILING_SLASH], "//sst.dev/")).toBeUndefined();
		expect(resolve([ADD_TRAILING_SLASH], "//sst.dev")).toBeUndefined();
	});

	it("honors a `missing` condition", () => {
		expect(resolve([STRIP_TRAILING_SLASH], "/asset.js/")?.headers.get("location")).toBe("/asset.js");
		expect(resolve([STRIP_TRAILING_SLASH], "/asset.js/", { "x-nextjs-data": "1" })).toBeUndefined();
	});

	it("honors a `has` condition", () => {
		const route = { ...ADD_TRAILING_SLASH, has: [{ type: "header", key: "x-canonical" }] };

		expect(resolve([route], "/blog")).toBeUndefined();
		expect(resolve([route], "/blog", { "x-canonical": "1" })?.status).toBe(308);
	});

	it("ignores a matching route that is not a redirect", () => {
		const route = { sourceRegex: "^/blog$", headers: { "x-custom": "1" }, priority: true };

		expect(resolve([route], "/blog")).toBeUndefined();
	});

	it("uses the first matching redirect", () => {
		const first = { ...ADD_TRAILING_SLASH, headers: { Location: "/first" } };
		const second = { ...ADD_TRAILING_SLASH, headers: { Location: "/second" } };

		expect(resolve([first, second], "/blog")?.headers.get("location")).toBe("/first");
	});

	it("does not carry headers from an incomplete route into a later redirect", () => {
		const incomplete = { ...ADD_TRAILING_SLASH, status: undefined, headers: { "x-first": "1" } };
		const redirect = { ...ADD_TRAILING_SLASH, headers: { Location: "/second" } };

		expect(resolve([incomplete, redirect], "/blog")?.headers.get("x-first")).toBeNull();
	});
});
