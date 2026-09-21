import path from "node:path";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { openNextResolvePlugin } from "../plugins/resolve.js";

import { createCacheBundle } from "./createCacheBundle.js";
import * as buildHelper from "./helper.js";

vi.mock("node:fs", () => ({
	default: { mkdirSync: vi.fn() },
}));

vi.mock("../plugins/resolve.js", () => ({
	openNextResolvePlugin: vi.fn(() => ({
		name: "opennext-resolve",
		setup: vi.fn(),
	})),
}));

vi.mock("./helper.js", () => ({
	copyOpenNextConfig: vi.fn(),
	esbuildAsync: vi.fn(),
}));

describe("createCacheBundle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("builds wrapped and raw cache handler entrypoints", async () => {
		const options = {
			buildDir: "/app/.open-next/.build",
			config: { default: {} },
			openNextDistDir: "/core/dist",
			outputDir: "/app/.open-next",
		};

		await createCacheBundle(options as never);

		expect(buildHelper.esbuildAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				entryPoints: {
					index: path.join(options.openNextDistDir, "adapters", "cache-adapter.js"),
					handler: path.join(options.openNextDistDir, "adapters", "cache-handler.js"),
				},
				outdir: path.join(options.outputDir, "cache-function"),
				outExtension: { ".js": ".mjs" },
			}),
			options
		);
	});

	test("falls back to legacy default function cache providers", async () => {
		const options = {
			buildDir: "/app/.open-next/.build",
			config: {
				default: {
					override: {
						incrementalCache: "legacy-incremental",
						tagCache: "legacy-tags",
						cdnInvalidation: "legacy-cdn",
					},
				},
			},
			openNextDistDir: "/core/dist",
			outputDir: "/app/.open-next",
		};

		await createCacheBundle(options as never);

		expect(openNextResolvePlugin).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					incrementalCache: "legacy-incremental",
					tagCache: "legacy-tags",
					cdnInvalidation: "legacy-cdn",
				}),
			})
		);
	});

	test("prefers cache handler providers over legacy defaults", async () => {
		const options = {
			buildDir: "/app/.open-next/.build",
			config: {
				default: {
					override: {
						incrementalCache: "legacy-incremental",
						tagCache: "legacy-tags",
						cdnInvalidation: "legacy-cdn",
					},
				},
				cacheHandler: {
					incrementalCache: "handler-incremental",
					tagCache: "handler-tags",
					cdnInvalidation: "handler-cdn",
				},
			},
			openNextDistDir: "/core/dist",
			outputDir: "/app/.open-next",
		};

		await createCacheBundle(options as never);

		expect(openNextResolvePlugin).toHaveBeenCalledWith(
			expect.objectContaining({
				overrides: expect.objectContaining({
					incrementalCache: "handler-incremental",
					tagCache: "handler-tags",
					cdnInvalidation: "handler-cdn",
				}),
			})
		);
	});
});
