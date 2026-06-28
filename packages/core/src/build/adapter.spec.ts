/* eslint-disable import/first */
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock node:fs to prevent actual file operations
vi.mock("node:fs", () => ({
	default: {
		mkdirSync: vi.fn(),
		copyFileSync: vi.fn(),
		writeFileSync: vi.fn(),
	},
	mkdirSync: vi.fn(),
	copyFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

// Mock node:module to control createRequire
vi.mock("node:module", () => ({
	createRequire: vi.fn(() => ({
		resolve: vi.fn(() => "/fake/opennext/dist/debug.js"),
	})),
}));

// Mock logger to capture log calls
vi.mock("../logger.js", () => ({
	default: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock all build functions
vi.mock("./compileConfig.js", () => ({
	compileOpenNextConfig: vi.fn(),
}));

vi.mock("./compileCache.js", () => ({
	compileCache: vi.fn(),
}));

vi.mock("./createMiddleware.js", () => ({
	createMiddleware: vi.fn(),
}));

vi.mock("./createAssets.js", () => ({
	createStaticAssets: vi.fn(),
	createCacheAssets: vi.fn(),
}));

vi.mock("./compileTagCacheProvider.js", () => ({
	compileTagCacheProvider: vi.fn(),
}));

vi.mock("./createServerBundle.js", () => ({
	createServerBundle: vi.fn(),
}));

vi.mock("./createRevalidationBundle.js", () => ({
	createRevalidationBundle: vi.fn(),
}));

vi.mock("./createImageOptimizationBundle.js", () => ({
	createImageOptimizationBundle: vi.fn(),
}));

vi.mock("./createWarmerBundle.js", () => ({
	createWarmerBundle: vi.fn(),
}));

vi.mock("./generateOutput.js", () => ({
	buildOpenNextOutput: vi.fn(),
	generateOutput: vi.fn(),
}));

vi.mock("../debug.js", () => ({
	addDebugFile: vi.fn(),
}));

vi.mock("./helper.js", () => ({
	normalizeOptions: vi.fn(),
	initOutputDir: vi.fn(),
	getPackagePath: vi.fn(),
}));

import { addDebugFile } from "../debug.js";
import logger from "../logger.js";
import type { OpenNextConfig } from "../types/open-next.js";

import { buildAdapter } from "./adapter.js";
import type { OpenNextAdapterOptions, BuildCompleteContext, NextAdapter } from "./adapter.js";
import { compileCache } from "./compileCache.js";
// Import mocked modules after vi.mock declarations
import { compileOpenNextConfig } from "./compileConfig.js";
import { compileTagCacheProvider } from "./compileTagCacheProvider.js";
import { createStaticAssets, createCacheAssets } from "./createAssets.js";
import { createImageOptimizationBundle } from "./createImageOptimizationBundle.js";
import { createMiddleware } from "./createMiddleware.js";
import { createRevalidationBundle } from "./createRevalidationBundle.js";
import { createServerBundle } from "./createServerBundle.js";
import { createWarmerBundle } from "./createWarmerBundle.js";
import { buildOpenNextOutput } from "./generateOutput.js";
import * as buildHelper from "./helper.js";
import type { BuildOptions } from "./helper.js";

// Helper to create mock build options
function createMockBuildOpts(): BuildOptions {
	return {
		appBuildOutputPath: "/app/build",
		appPackageJsonPath: "/app/package.json",
		appPath: "/app",
		appPublicPath: "/app/public",
		buildDir: "/app/.open-next/.build",
		config: {
			default: {},
			dangerous: {},
		} as unknown as OpenNextConfig,
		debug: false,
		minify: true,
		monorepoRoot: "/app",
		nextVersion: "16.0.0",
		openNextVersion: "0.1.0",
		openNextDistDir: "/fake/opennext/dist",
		outputDir: "/app/.open-next",
		packager: "npm" as const,
		tempBuildDir: "/tmp/open-next-tmp",
	} as BuildOptions;
}

// Helper to create mock BuildCompleteContext
function createMockContext(): BuildCompleteContext {
	return {
		routes: [],
		outputs: {
			pages: [],
			pagesApi: [],
			appPages: [],
			appRoutes: [],
		},
		projectDir: "/app",
		repoRoot: "/app",
		distDir: "/app/.next",
		config: {
			experimental: {},
			images: {},
		} as BuildCompleteContext["config"],
		nextVersion: "16.0.0",
	};
}

describe("buildAdapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Set up default mock implementations
		const mockBuildOpts = createMockBuildOpts();

		vi.mocked(compileOpenNextConfig).mockResolvedValue({
			config: { default: {}, dangerous: {} } as unknown as OpenNextConfig,
			buildDir: "/tmp/open-next-tmp",
		});

		vi.mocked(buildHelper.normalizeOptions).mockReturnValue(mockBuildOpts);
		vi.mocked(buildHelper.initOutputDir).mockImplementation(() => {});
		vi.mocked(buildHelper.getPackagePath).mockReturnValue("");

		vi.mocked(compileCache).mockReturnValue({
			cache: "/tmp/cache.cjs",
			composableCache: "/tmp/composable-cache.cjs",
		});

		vi.mocked(createCacheAssets).mockReturnValue({
			useTagCache: false,
			metaFiles: [],
		});
	});

	test("returns an object with name, modifyConfig, and onBuildComplete", () => {
		const adapter = buildAdapter(() => ({}));

		expect(adapter.name).toBe("OpenNext");
		expect(typeof adapter.modifyConfig).toBe("function");
		expect(typeof adapter.onBuildComplete).toBe("function");
	});

	test("modifyConfig calls compileOpenNextConfig with compileEdge: true, then callback", async () => {
		const mockCallback = vi.fn(() => ({}));
		const adapter = buildAdapter(mockCallback);

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		expect(compileOpenNextConfig).toHaveBeenCalledWith("open-next.config.ts", { compileEdge: true });
		expect(mockCallback).toHaveBeenCalledOnce();
		// The callback receives (config, buildOpts)
		expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({ default: {} }), expect.any(Object));
	});

	test("modifyConfig returns nextConfig with cacheHandler, cacheHandlers, cacheMaxMemorySize, and trustHostHeader", async () => {
		const adapter = buildAdapter(() => ({}));

		const nextConfig = {
			experimental: { serverActions: true },
			images: {},
		} as unknown as BuildCompleteContext["config"];

		const result = await adapter.modifyConfig(nextConfig, { phase: "production" });

		expect(result.cacheHandler).toBe("/tmp/cache.cjs");
		expect(result.cacheHandlers).toEqual({
			default: "/tmp/composable-cache.cjs",
			remote: "/tmp/composable-cache.cjs",
		});
		expect(result.cacheMaxMemorySize).toBe(0);
		expect(result.experimental.trustHostHeader).toBe(true);
		// Original experimental properties preserved
		expect(result.experimental.serverActions).toBe(true);
	});

	test("onBuildComplete calls createMiddleware with influence.middlewareOptions", async () => {
		const adapter = buildAdapter(() => ({
			middlewareOptions: { forceOnlyBuildOnce: true },
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createMiddleware).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({ forceOnlyBuildOnce: true })
		);
	});

	test("onBuildComplete skips createRevalidationBundle when skipRevalidation is true", async () => {
		const adapter = buildAdapter(() => ({
			skipRevalidation: true,
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createRevalidationBundle).not.toHaveBeenCalled();
	});

	test("onBuildComplete calls influence.beforeMiddleware BEFORE createMiddleware", async () => {
		const callOrder: string[] = [];

		const adapter = buildAdapter(() => ({
			beforeMiddleware: vi.fn(async () => {
				callOrder.push("beforeMiddleware");
			}),
		}));

		vi.mocked(createMiddleware).mockImplementation(async () => {
			callOrder.push("createMiddleware");
		});

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(callOrder).toEqual(["beforeMiddleware", "createMiddleware"]);
	});

	test("onBuildComplete calls influence.afterServerBundle after createServerBundle but BEFORE createRevalidationBundle", async () => {
		const callOrder: string[] = [];

		const adapter = buildAdapter(() => ({
			afterServerBundle: vi.fn(async () => {
				callOrder.push("afterServerBundle");
			}),
		}));

		vi.mocked(createServerBundle).mockImplementation(async () => {
			callOrder.push("createServerBundle");
		});

		vi.mocked(createRevalidationBundle).mockImplementation(async () => {
			callOrder.push("createRevalidationBundle");
		});

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(callOrder).toEqual(["createServerBundle", "afterServerBundle", "createRevalidationBundle"]);
	});

	test("edge compilation failure retries with compileEdge: false and logs a warning", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.mocked(compileOpenNextConfig)
			.mockRejectedValueOnce(new Error("Edge compilation failed: cannot resolve node:fs"))
			.mockResolvedValueOnce({
				config: { default: {}, dangerous: {} } as unknown as OpenNextConfig,
				buildDir: "/tmp/open-next-tmp",
			});

		const adapter = buildAdapter(() => ({}));
		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		expect(compileOpenNextConfig).toHaveBeenCalledTimes(2);
		expect(compileOpenNextConfig).toHaveBeenNthCalledWith(1, "open-next.config.ts", { compileEdge: true });
		expect(compileOpenNextConfig).toHaveBeenNthCalledWith(2, "open-next.config.ts", { compileEdge: false });
		expect(warnSpy).toHaveBeenCalledOnce();

		warnSpy.mockRestore();
	});

	test("influence.tempCachePath override is called with (buildOpts, packagePath)", async () => {
		const mockTempCachePath = vi.fn(() => "/custom/temp/cache/path");

		const adapter = buildAdapter(() => ({
			tempCachePath: mockTempCachePath,
		}));

		vi.mocked(buildHelper.getPackagePath).mockReturnValue("packages/my-app");

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		expect(mockTempCachePath).toHaveBeenCalledWith(expect.any(Object), "packages/my-app");

		// Verify the custom path was used for mkdirSync
		const fs = await import("node:fs");
		expect(fs.default.mkdirSync).toHaveBeenCalledWith("/custom/temp/cache/path", { recursive: true });
	});

	test("onBuildComplete skips image optimization when skipImageOptimization is true", async () => {
		const adapter = buildAdapter(() => ({
			skipImageOptimization: true,
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createImageOptimizationBundle).not.toHaveBeenCalled();
	});

	test("onBuildComplete skips warmer when skipWarmer is true", async () => {
		const adapter = buildAdapter(() => ({
			skipWarmer: true,
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createWarmerBundle).not.toHaveBeenCalled();
	});

	test("onBuildComplete skips generateOutput when skipGenerateOutput is true", async () => {
		const adapter = buildAdapter(() => ({
			skipGenerateOutput: true,
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(buildOpenNextOutput).not.toHaveBeenCalled();
		const fs = await import("node:fs");
		expect(fs.default.writeFileSync).not.toHaveBeenCalled();
	});

	test("onBuildComplete calls addDebugFile with outputs.json", async () => {
		const adapter = buildAdapter(() => ({}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(addDebugFile).toHaveBeenCalledWith(expect.any(Object), "outputs.json", ctx);
	});

	test("onBuildComplete passes serverBundle customization to createServerBundle", async () => {
		const mockPlugins = vi.fn(() => []);
		const mockPatches = [{ name: "test-patch", patches: [] }];

		const adapter = buildAdapter(() => ({
			serverBundle: {
				additionalPlugins: mockPlugins,
				additionalCodePatches: mockPatches,
				useEdgeConfig: true,
				externals: ["some-external"],
				banner: ["// custom banner"],
			},
		}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createServerBundle).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				additionalPlugins: expect.any(Function),
				additionalCodePatches: mockPatches,
				useEdgeConfig: true,
				externals: ["some-external"],
				banner: ["// custom banner"],
			}),
			ctx.outputs
		);
	});

	test("onBuildComplete compiles tag cache provider when useTagCache is true", async () => {
		vi.mocked(createCacheAssets).mockReturnValue({
			useTagCache: true,
			metaFiles: [],
		});

		const adapter = buildAdapter(() => ({}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(compileTagCacheProvider).toHaveBeenCalledWith(expect.any(Object), undefined);
	});

	test("onBuildComplete skips cache assets when disableIncrementalCache is true", async () => {
		const mockBuildOpts = createMockBuildOpts();
		(mockBuildOpts.config as OpenNextConfig).dangerous = { disableIncrementalCache: true };
		vi.mocked(buildHelper.normalizeOptions).mockReturnValue(mockBuildOpts);

		const adapter = buildAdapter(() => ({}));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });

		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);

		expect(createCacheAssets).not.toHaveBeenCalled();
		expect(compileTagCacheProvider).not.toHaveBeenCalled();
	});

	test("validateConfig override is called after callback in modifyConfig and halts build on shouldThrow:true", async () => {
		const mockValidator = vi.fn(() => ({ success: false, shouldThrow: true, message: "nope" }));
		const adapter = buildAdapter(() => ({ validateConfig: mockValidator }));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await expect(adapter.modifyConfig(nextConfig, { phase: "production" })).rejects.toThrow("nope");
		expect(mockValidator).toHaveBeenCalledOnce();
	});

	test("validateConfig override with shouldThrow:false logs warn and continues", async () => {
		const mockValidator = vi.fn(() => ({ success: false, message: "heads up" }));
		const adapter = buildAdapter(() => ({ validateConfig: mockValidator }));

		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });
		expect(logger.warn).toHaveBeenCalledWith("heads up");
	});

	test("onBuildComplete calls generateOutput override and writes its return via buildAdapter", async () => {
		const mockOutput = vi.fn(async () => ({ custom: "shape" }));
		const adapter = buildAdapter(() => ({ generateOutput: mockOutput }));
		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });
		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);
		expect(mockOutput).toHaveBeenCalledWith(expect.any(Object));
		const fs = await import("node:fs");
		expect(fs.default.writeFileSync).toHaveBeenCalledWith(
			expect.stringMatching(/\/\.open-next\/open-next\.output\.json$/),
			JSON.stringify({ custom: "shape" })
		);
	});

	test("onBuildComplete with default generateOutput calls buildOpenNextOutput and writes result", async () => {
		vi.mocked(buildOpenNextOutput).mockResolvedValue({
			origins: { default: {} },
		} as any); // oxlint-disable-line @typescript-eslint/no-explicit-any
		const adapter = buildAdapter(() => ({}));
		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });
		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);
		expect(buildOpenNextOutput).toHaveBeenCalledWith(expect.any(Object));
		const fs = await import("node:fs");
		expect(fs.default.writeFileSync).toHaveBeenCalledWith(
			expect.stringMatching(/\/\.open-next\/open-next\.output\.json$/),
			JSON.stringify({ origins: { default: {} } })
		);
	});

	test("onBuildComplete skipGenerateOutput skips generateOutput override and buildOpenNextOutput", async () => {
		const mockOutput = vi.fn();
		const adapter = buildAdapter(() => ({ skipGenerateOutput: true, generateOutput: mockOutput }));
		const nextConfig = { experimental: {}, images: {} } as BuildCompleteContext["config"];
		await adapter.modifyConfig(nextConfig, { phase: "production" });
		const ctx = createMockContext();
		await adapter.onBuildComplete(ctx);
		expect(buildOpenNextOutput).not.toHaveBeenCalled();
		expect(mockOutput).not.toHaveBeenCalled();
		const fs = await import("node:fs");
		expect(fs.default.writeFileSync).not.toHaveBeenCalled();
	});
});
