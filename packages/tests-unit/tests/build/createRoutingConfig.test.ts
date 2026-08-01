import fs from "node:fs";

import type { BuildCompleteContext } from "@opennextjs/core/build/adapter.js";
import { createRoutingConfig } from "@opennextjs/core/build/createRoutingConfig.js";
import { vi } from "vitest";

vi.mock("node:fs");

describe("createRoutingConfig", () => {
	it("serializes routing metadata and executable route classifications", () => {
		const context = {
			buildId: "build-id",
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
});
