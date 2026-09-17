import fs from "node:fs";

import type { BuildCompleteContext } from "@opennextjs/core/build/adapter.js";
import { createRoutingConfig } from "@opennextjs/core/build/createRoutingConfig.js";
import { vi } from "vitest";

vi.mock("node:fs");

describe("createRoutingConfig", () => {
	it("serializes routing metadata and executable route classifications", () => {
		const context = {
			buildId: "build-id",
			config: {},
			routing: {
				beforeMiddleware: [],
				beforeFiles: [],
				afterFiles: [],
				dynamicRoutes: [],
				onMatch: [],
				fallback: [],
			},
			outputs: {
				pages: [{ id: "pages", pathname: "/pages", filePath: "/pages.js", assets: {} }],
				pagesApi: [{ id: "api", pathname: "/api/hello", filePath: "/api.js", assets: {} }],
				appPages: [{ id: "app", pathname: "/app", filePath: "/app.js", assets: {} }],
				appRoutes: [{ id: "route", pathname: "/route", filePath: "/route.js", assets: {} }],
				staticFiles: [{ id: "asset", pathname: "/asset.js", filePath: "/asset.js", assets: {} }],
				prerenders: [
					// The template of a dynamic route and a prerendered non dynamic route.
					{ pathname: "/app", parentOutputId: "app" },
					{ pathname: "/pages", parentOutputId: "pages" },
					// Concrete paths and data variants do not match an executable route.
					{ pathname: "/pages/prerendered", parentOutputId: "pages" },
					{ pathname: "/app.rsc", parentOutputId: "app" },
				],
			},
		} as BuildCompleteContext;

		const result = createRoutingConfig({ appBuildOutputPath: "/app" } as never, context);

		expect(result).toEqual({
			buildId: "build-id",
			routes: context.routing,
			pathnames: ["/pages", "/api/hello", "/app", "/route", "/asset.js", "/pages/prerendered", "/app.rsc"],
			routeIndex: {
				"/pages": { type: "page", isFallback: false, isISR: true },
				"/api/hello": { type: "page", isFallback: false, isISR: false },
				"/app": { type: "app", isFallback: false, isISR: true },
				"/route": { type: "route", isFallback: false, isISR: false },
				"/pages/prerendered": {
					type: "page",
					isFallback: false,
					isISR: true,
					route: "/pages",
				},
				"/app.rsc": { type: "app", isFallback: false, isISR: true, route: "/app" },
			},
		});
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			"/app/.next/open-next-routing.json",
			JSON.stringify(result)
		);
	});

	it("emits a trailing slash variant of every non file pathname when `trailingSlash` is enabled", () => {
		const context = {
			buildId: "build-id",
			config: { trailingSlash: true },
			routing: {
				beforeMiddleware: [],
				beforeFiles: [],
				afterFiles: [],
				dynamicRoutes: [],
				onMatch: [],
				fallback: [],
			},
			outputs: {
				pages: [
					{ pathname: "/pages", filePath: "/pages.js", assets: {} },
					{ pathname: "/blog/[slug]", filePath: "/blog.js", assets: {} },
					// Data variants are files - Next strips their trailing slash instead of adding one.
					{ pathname: "/_next/data/build-id/pages.json", filePath: "/pages.js", assets: {} },
				],
				pagesApi: [{ pathname: "/api/hello", filePath: "/api.js", assets: {} }],
				appPages: [{ pathname: "/", filePath: "/index.js", assets: {} }],
				appRoutes: [],
				staticFiles: [{ pathname: "/asset.js", filePath: "/asset.js", assets: {} }],
			},
		} as unknown as BuildCompleteContext;

		const result = createRoutingConfig({ appBuildOutputPath: "/app" } as never, context);

		expect(result.pathnames).toEqual([
			"/pages",
			"/pages/",
			"/blog/[slug]",
			"/blog/[slug]/",
			"/_next/data/build-id/pages.json",
			"/api/hello",
			"/api/hello/",
			"/",
			"/asset.js",
		]);
	});

	it("serves prerendered pathnames from the route that generated them", () => {
		const context = {
			buildId: "build-id",
			config: {},
			routing: {
				beforeMiddleware: [],
				beforeFiles: [],
				afterFiles: [],
				dynamicRoutes: [
					{
						sourceRegex: String.raw`^/_next/data/build\-id/blog/(?<nxtPslug>[^/]+?)\.json$`,
						destination: "/_next/data/build-id/blog/[slug].json?nxtPslug=$nxtPslug",
						// Prerendered routes are only routed to their function in draft mode.
						has: [{ type: "cookie", key: "__prerender_bypass" }],
					},
					{
						sourceRegex: String.raw`^/blog/(?<nxtPslug>[^/]+?)$`,
						destination: "/blog/[slug]?nxtPslug=$nxtPslug",
						has: [{ type: "cookie", key: "__prerender_bypass" }],
					},
				],
				onMatch: [],
				fallback: [],
			},
			outputs: {
				pages: [
					{ id: "blog-output", pathname: "/blog/[slug]", filePath: "/blog.js", assets: {} },
					{ id: "isr-output", pathname: "/isr", filePath: "/isr.js", assets: {} },
				],
				pagesApi: [],
				appPages: [],
				appRoutes: [],
				prerenders: [
					// A concrete prerendered pathname and its data variant, neither of which is executable.
					{ pathname: "/blog/hello", parentOutputId: "blog-output" },
					{ pathname: "/_next/data/build-id/blog/hello.json", parentOutputId: "blog-output" },
					// The template of the dynamic route generating them, and its data variant.
					{ pathname: "/blog/[slug]", parentOutputId: "blog-output" },
					{ pathname: "/_next/data/build-id/blog/[slug].json", parentOutputId: "blog-output" },
					// A non dynamic prerendered route and its data variant.
					{ pathname: "/isr", parentOutputId: "isr-output" },
					{ pathname: "/_next/data/build-id/isr.json", parentOutputId: "isr-output" },
					// A PPR segment prefetch - no route can regenerate it.
					{ pathname: "/isr.segments/_tree.segment.rsc", parentOutputId: "isr-output" },
				],
			},
		} as unknown as BuildCompleteContext;

		const result = createRoutingConfig({ appBuildOutputPath: "/app" } as never, context);

		expect(result.pathnames).toEqual([
			"/blog/[slug]",
			"/isr",
			"/blog/hello",
			"/_next/data/build-id/blog/hello.json",
			"/_next/data/build-id/blog/[slug].json",
			"/_next/data/build-id/isr.json",
			"/isr.segments/_tree.segment.rsc",
		]);
		expect(result.routeIndex).toEqual({
			"/blog/[slug]": { type: "page", isFallback: false, isISR: true },
			"/isr": { type: "page", isFallback: false, isISR: true },
			"/blog/hello": { type: "page", isFallback: false, isISR: true, route: "/blog/[slug]" },
			"/_next/data/build-id/blog/hello.json": {
				type: "page",
				isFallback: false,
				isISR: true,
				route: "/blog/[slug]",
			},
			"/_next/data/build-id/blog/[slug].json": {
				type: "page",
				isFallback: false,
				isISR: true,
				route: "/blog/[slug]",
			},
			"/_next/data/build-id/isr.json": {
				type: "page",
				isFallback: false,
				isISR: true,
				route: "/isr",
			},
			"/isr.segments/_tree.segment.rsc": {
				type: "page",
				isFallback: false,
				isISR: true,
				route: "/isr",
			},
		});
	});

	it("keeps the highest priority dynamic route when it has no executable destination", () => {
		const context = {
			buildId: "build-id",
			config: {},
			routing: {
				beforeMiddleware: [],
				beforeFiles: [],
				afterFiles: [],
				dynamicRoutes: [
					// `/blog/[slug]` takes precedence over the catch all, but only the catch all is
					// executable - the prerendered pathname must not fall through to it.
					{
						sourceRegex: String.raw`^/blog/(?<nxtPslug>[^/]+?)$`,
						destination: "/blog/[slug]?nxtPslug=$nxtPslug",
					},
					{
						sourceRegex: String.raw`^/blog/(?<nxtPslugs>.+?)$`,
						destination: "/blog/[...slugs]?nxtPslugs=$nxtPslugs",
					},
				],
				onMatch: [],
				fallback: [],
			},
			outputs: {
				pages: [{ id: "catch-all", pathname: "/blog/[...slugs]", filePath: "/slugs.js", assets: {} }],
				pagesApi: [],
				appPages: [],
				appRoutes: [],
				prerenders: [{ pathname: "/blog/hello", parentOutputId: "missing-specific-route" }],
			},
		} as unknown as BuildCompleteContext;

		const result = createRoutingConfig({ appBuildOutputPath: "/app" } as never, context);

		expect(result.pathnames).toEqual(["/blog/[...slugs]"]);
		expect(result.routeIndex).toEqual({
			"/blog/[...slugs]": { type: "page", isFallback: false, isISR: false },
		});
	});
});
