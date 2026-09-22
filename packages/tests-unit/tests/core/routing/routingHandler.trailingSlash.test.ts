import routingHandler from "@opennextjs/core/core/routingHandler.js";
import type { InternalEvent, InternalResult, RoutingResult } from "@opennextjs/core/types/open-next.js";
import { vi } from "vitest";

vi.mock("@/config/index", () => ({
	BuildId: "build-id",
	NextConfig: {
		experimental: {},
		images: {},
		trailingSlash: true,
		i18n: { locales: ["en", "fr"], defaultLocale: "en" },
	},
	RoutingConfig: {
		buildId: "build-id",
		// `createRoutingConfig` emits the trailing slash variant of every non file pathname.
		pathnames: [
			"/en/ssr",
			"/en/ssr/",
			"/_next/data/build-id/en/ssr.json",
			"/en/isr",
			"/en/isr/",
			"/_next/data/build-id/en/isr.json",
		],
		routeIndex: {
			"/en/ssr": { type: "page", isFallback: false, isISR: false },
			"/_next/data/build-id/en/ssr.json": { type: "page", isFallback: false, isISR: false },
			"/en/isr": { type: "page", isFallback: false, isISR: true },
			// The data variant of a prerendered route is served by the route itself.
			"/_next/data/build-id/en/isr.json": {
				type: "page",
				isFallback: false,
				isISR: true,
				route: "/en/isr",
			},
		},
		routes: {
			// The canonicalizing redirects Next emits for `trailingSlash: true`.
			beforeMiddleware: [
				{
					sourceRegex: String.raw`^(?:\/((?!\.well-known(?:\/.*)?)(?:[^/]+\/)*[^/]+\.\w+))\/$`,
					headers: { Location: "/$1" },
					status: 308,
					missing: [{ type: "header", key: "x-nextjs-data" }],
					priority: true,
				},
				{
					sourceRegex: String.raw`^(?:\/((?!\.well-known(?:\/.*)?)(?:[^/]+\/)*[^/\.]+))$`,
					headers: { Location: "/$1/" },
					status: 308,
					priority: true,
				},
			],
			beforeFiles: [],
			afterFiles: [],
			dynamicRoutes: [],
			onMatch: [],
			fallback: [],
			shouldNormalizeNextData: true,
		},
	},
	PrerenderManifest: { routes: {}, dynamicRoutes: {}, preview: {} },
	MiddlewareManifest: { middleware: {}, functions: {}, version: 1 },
	FunctionsConfigManifest: { functions: {}, version: 1 },
}));

function event(target: string): InternalEvent {
	const [rawPath] = target.split("?");
	return {
		type: "core",
		method: "GET",
		rawPath,
		url: `https://localhost${target}`,
		headers: { host: "localhost" },
		query: {},
		cookies: {},
		remoteAddress: "127.0.0.1",
	};
}

beforeEach(() => {
	globalThis.openNextConfig = {};
});

describe("routingHandler trailing slash", () => {
	it("redirects a pathname to its canonical trailing slash form", async () => {
		const result = (await routingHandler(event("/ssr"))) as InternalResult;

		expect(result.statusCode).toBe(308);
		expect(result.headers.location).toBe("/ssr/");
	});

	it("carries the query of the request over to the redirect", async () => {
		const result = (await routingHandler(event("/ssr?happy=true"))) as InternalResult;

		expect(result.statusCode).toBe(308);
		expect(result.headers.location).toBe("/ssr/?happy=true");
	});

	it("resolves a pathname already in its canonical form", async () => {
		const result = (await routingHandler(event("/ssr/"))) as RoutingResult;

		expect(result.resolvedRoutes).toEqual([
			{ route: "/en/ssr", type: "page", isFallback: false, isISR: false },
		]);
	});

	// The resolver normalizes `/_next/data/` pathnames to the page they carry before running
	// `beforeMiddleware`, which would have the canonicalizing redirect send every data request to
	// its page. Next matches those redirects against the request as it came in, where the `.json`
	// pathname never looks like a page.
	it("does not redirect the `_next/data` request of a route with its own data output", async () => {
		const result = (await routingHandler(event("/_next/data/build-id/en/ssr.json"))) as RoutingResult;

		expect(result.resolvedRoutes).toEqual([
			{ route: "/_next/data/build-id/en/ssr.json", type: "page", isFallback: false, isISR: false },
		]);
	});

	it("does not redirect the `_next/data` request of a prerendered route", async () => {
		const result = (await routingHandler(event("/_next/data/build-id/en/isr.json"))) as RoutingResult;

		expect(result.resolvedRoutes).toEqual([
			{ route: "/en/isr", type: "page", isFallback: false, isISR: true },
		]);
	});
});
