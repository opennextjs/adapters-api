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
				pages: [{ pathname: "/pages", filePath: "/pages.js", assets: {} }],
				pagesApi: [{ pathname: "/api/hello", filePath: "/api.js", assets: {} }],
				appPages: [{ pathname: "/app", filePath: "/app.js", assets: {} }],
				appRoutes: [{ pathname: "/route", filePath: "/route.js", assets: {} }],
				staticFiles: [{ pathname: "/asset.js", filePath: "/asset.js", assets: {} }],
				prerenders: [
					// The template of a dynamic route and a prerendered non dynamic route.
					{ pathname: "/app" },
					{ pathname: "/pages" },
					// Concrete paths and data variants do not match an executable route.
					{ pathname: "/pages/prerendered" },
					{ pathname: "/app.rsc" },
				],
			},
		} as BuildCompleteContext;

		const result = createRoutingConfig({ appBuildOutputPath: "/app" } as never, context);

		expect(result).toEqual({
			buildId: "build-id",
			routes: context.routing,
			pathnames: ["/pages", "/api/hello", "/app", "/route", "/asset.js"],
			routeIndex: {
				"/pages": { type: "page", isFallback: false, isISR: true },
				"/api/hello": { type: "page", isFallback: false, isISR: false },
				"/app": { type: "app", isFallback: false, isISR: true },
				"/route": { type: "route", isFallback: false, isISR: false },
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
});
