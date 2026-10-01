import fs from "node:fs";
import { createRequire } from "node:module";

import { patchCode } from "@opennextjs/core/build/patch/astCodePatcher.js";
import { rule } from "@opennextjs/core/build/patch/patches/patchTagStaleness.js";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(new URL("../../../../../core/package.json", import.meta.url));
const filename = require.resolve("next/dist/server/lib/incremental-cache/index.js");
const source = fs.readFileSync(filename, "utf8");
const patched = patchCode(source, rule);
const module = {
	exports:
		{} as typeof import("../../../../../core/node_modules/next/dist/server/lib/incremental-cache/index.js"),
};
new Function("require", "exports", "module", patched)(createRequire(filename), module.exports, module);

describe("tag staleness in the installed Next incremental cache", () => {
	it("patches the real Next source", () => {
		expect(patched).not.toBe(source);
	});

	it.each([false, 3600] as const)("marks a fresh route stale with revalidate=%s", async (revalidate) => {
		const cache = new module.exports.IncrementalCache({
			dev: false,
			requestHeaders: {},
			getPrerenderManifest: () =>
				({
					routes: {},
					dynamicRoutes: {},
					notFoundRoutes: [],
					preview: { previewModeId: "test" },
					version: 4,
				}) as never,
		});
		cache.cacheControls.get = () => ({ revalidate });
		const entry = {
			lastModified: Date.now(),
			isStale: true,
			value: { kind: "APP_ROUTE", body: Buffer.from("data"), status: 200, headers: {} },
		};
		cache.cacheHandler = { get: vi.fn().mockResolvedValue(entry) } as never;
		expect(await cache.get("/page", { kind: "APP_ROUTE" } as never)).toMatchObject({ isStale: true });
		entry.isStale = false;
		expect((await cache.get("/page", { kind: "APP_ROUTE" } as never))?.isStale).not.toBe(true);
		entry.lastModified = -1;
		entry.isStale = true;
		expect((await cache.get("/page", { kind: "APP_ROUTE" } as never))?.isStale).toBe(-1);
	});

	it("marks fresh fetch data stale and preserves misses", async () => {
		const cache = new module.exports.IncrementalCache({
			dev: false,
			requestHeaders: {},
			getPrerenderManifest: () =>
				({
					routes: {},
					dynamicRoutes: {},
					notFoundRoutes: [],
					preview: { previewModeId: "test" },
					version: 4,
				}) as never,
		});
		const get = vi.fn().mockResolvedValue({
			lastModified: Date.now(),
			isStale: true,
			value: { kind: "FETCH", data: { body: "data" }, revalidate: 3600 },
		});
		cache.cacheHandler = { get } as never;
		expect(await cache.get("fetch-key", { kind: "FETCH", revalidate: 3600 } as never)).toMatchObject({
			isStale: true,
		});
		get.mockResolvedValue(null);
		expect(await cache.get("fetch-key", { kind: "FETCH" } as never)).toBeNull();
	});
});
