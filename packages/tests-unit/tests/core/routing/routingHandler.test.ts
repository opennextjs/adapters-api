import routingHandler from "@opennextjs/core/core/routingHandler.js";
import type { InternalEvent, InternalResult } from "@opennextjs/core/types/open-next.js";
import { vi } from "vitest";

vi.mock("@/config/index", () => ({
	BuildId: "build-id",
	NextConfig: { experimental: {}, images: {} },
	RoutingConfig: {
		buildId: "build-id",
		// `/about/` is the trailing slash variant emitted for `trailingSlash` enabled apps and
		// `/blog/prerendered` a prerendered pathname of the `/blog/[slug]` route.
		pathnames: ["/about", "/about/", "/blog/[slug]", "/blog/prerendered", "/ssr"],
		routeIndex: {
			"/about": { type: "app", isFallback: false, isISR: false },
			"/blog/[slug]": { type: "app", isFallback: false, isISR: true },
			"/blog/prerendered": { type: "app", isFallback: false, isISR: true, route: "/blog/[slug]" },
			"/ssr": { type: "app", isFallback: false, isISR: false },
		},
		routes: {
			beforeMiddleware: [
				{
					sourceRegex: "^/old$",
					destination: "/about",
					headers: { location: "/about" },
					status: 308,
				},
				{
					sourceRegex: "^/moved$",
					destination: "/about?q=a b",
					headers: { Location: "https://localhost/about?q=a b", "x-custom": "1" },
					status: 308,
				},
			],
			beforeFiles: [],
			afterFiles: [
				{ sourceRegex: "^/rewrite$", destination: "/about?from=rewrite" },
				{ sourceRegex: "^/external$", destination: "https://example.com/target" },
			],
			dynamicRoutes: [
				{
					sourceRegex: "^/blog/(?<nxtPslug>[^/]+?)$",
					destination: "/blog/[slug]?slug=$nxtPslug",
				},
			],
			onMatch: [],
			fallback: [],
		},
	},
	PrerenderManifest: { routes: {}, dynamicRoutes: {}, preview: {} },
	MiddlewareManifest: { middleware: {}, functions: {}, version: 1 },
	FunctionsConfigManifest: { functions: {}, version: 1 },
}));

function event(pathname: string): InternalEvent {
	return {
		type: "core",
		method: "GET",
		rawPath: pathname,
		url: `https://localhost${pathname}`,
		headers: { host: "localhost" },
		query: {},
		cookies: {},
		remoteAddress: "127.0.0.1",
	};
}

beforeEach(() => {
	globalThis.openNextConfig = {};
});

describe("routingHandler", () => {
	it("uses the resolved pathname to select the executable route", async () => {
		const result = await routingHandler(event("/about"));

		expect(result).toMatchObject({
			internalEvent: {
				rawPath: "/about",
				url: "https://localhost/about",
			},
			resolvedRoutes: [{ route: "/about", type: "app", isFallback: false }],
		});
	});

	it("selects the executable route of a pathname resolved with a trailing slash", async () => {
		const result = await routingHandler(event("/about/"));

		expect(result).toMatchObject({
			internalEvent: {
				rawPath: "/about/",
				url: "https://localhost/about/",
			},
			resolvedRoutes: [{ route: "/about", type: "app", isFallback: false }],
		});
	});

	it("flags requests resolving to a prerendered route as ISR", async () => {
		const result = await routingHandler(event("/blog/hello"));

		expect(result).toMatchObject({
			isISR: true,
			resolvedRoutes: [{ route: "/blog/[slug]", type: "app", isFallback: false, isISR: true }],
		});
	});

	it("serves a prerendered pathname from the route that generated it", async () => {
		const result = await routingHandler(event("/blog/prerendered"));

		expect(result).toMatchObject({
			isISR: true,
			internalEvent: {
				rawPath: "/blog/prerendered",
				url: "https://localhost/blog/prerendered?slug=prerendered",
			},
			resolvedRoutes: [{ route: "/blog/[slug]", type: "app", isFallback: false, isISR: true }],
		});
	});

	it("does not flag requests resolving to a non prerendered route as ISR", async () => {
		const result = await routingHandler(event("/ssr"));

		expect(result).toMatchObject({ isISR: false });
	});

	it("does not flag unresolved routes as ISR", async () => {
		const result = await routingHandler(event("/unknown"));

		expect(result).toMatchObject({
			isISR: false,
			internalEvent: { rawPath: "/404" },
			resolvedRoutes: [],
		});
	});

	it("returns redirects directly without invoking an entrypoint", async () => {
		const result = await routingHandler(event("/old"));

		expect(result).toMatchObject({
			statusCode: 308,
			headers: { location: "/about" },
		});
	});

	it("returns a single redirect target when the matched route already set a location", async () => {
		const result = await routingHandler(event("/moved"));

		expect((result as InternalResult).headers).toMatchObject({
			location: "/about?q=a%20b",
			"x-custom": "1",
		});
		expect(
			Object.keys((result as InternalResult).headers).filter((key) => key.toLowerCase() === "location")
		).toEqual(["location"]);
	});

	it("uses the resolver invocation target for internal rewrites", async () => {
		const result = await routingHandler(event("/rewrite"));

		expect(result).toMatchObject({
			internalEvent: {
				rawPath: "/about",
				url: "https://localhost/about?from=rewrite",
				query: { from: "rewrite" },
			},
			resolvedRoutes: [{ route: "/about", type: "app", isFallback: false }],
		});
	});

	it("preserves external rewrites for the proxy layer", async () => {
		const result = await routingHandler(event("/external"));

		expect(result).toMatchObject({
			isExternalRewrite: true,
			internalEvent: {
				rawPath: "/target",
				url: "https://example.com/target",
			},
		});
	});
});
