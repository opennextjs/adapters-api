import routingHandler from "@opennextjs/core/core/routingHandler.js";
import type { InternalEvent } from "@opennextjs/core/types/open-next.js";
import { vi } from "vitest";

vi.mock("@/config/index", () => ({
	BuildId: "build-id",
	NextConfig: { experimental: {}, images: {} },
	RoutingConfig: {
		buildId: "build-id",
		pathnames: ["/about"],
		routeIndex: {
			"/about": { type: "app", isFallback: false },
		},
		routes: {
			beforeMiddleware: [
				{
					sourceRegex: "^/old$",
					destination: "/about",
					headers: { location: "/about" },
					status: 308,
				},
			],
			beforeFiles: [],
			afterFiles: [
				{ sourceRegex: "^/rewrite$", destination: "/about?from=rewrite" },
				{ sourceRegex: "^/external$", destination: "https://example.com/target" },
			],
			dynamicRoutes: [],
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

	it("returns redirects directly without invoking an entrypoint", async () => {
		const result = await routingHandler(event("/old"));

		expect(result).toMatchObject({
			statusCode: 308,
			headers: { Location: "/about" },
		});
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
