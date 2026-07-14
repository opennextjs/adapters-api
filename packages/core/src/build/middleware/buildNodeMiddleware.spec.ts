/* eslint-disable import/first */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../plugins/content-updater.js", () => {
	const ContentUpdater = vi.fn().mockImplementation(() => ({
		plugin: { name: "content-updater-mock", setup: vi.fn() },
	}));
	return { ContentUpdater };
});

vi.mock("../../plugins/externalMiddleware.js", () => ({
	openNextExternalMiddlewarePlugin: vi.fn(() => ({ name: "external-middleware-mock", setup: vi.fn() })),
}));

vi.mock("../../plugins/replacement.js", () => ({
	openNextReplacementPlugin: vi.fn(() => ({ name: "replacement-mock", setup: vi.fn() })),
}));

vi.mock("../../plugins/resolve.js", () => ({
	openNextResolvePlugin: vi.fn(() => ({ name: "resolve-mock", setup: vi.fn() })),
}));

vi.mock("../copyAdapterFiles.js", () => ({
	copyAdapterFiles: vi.fn(async () => ["/app/.open-next/middleware/middleware.js"]),
}));

vi.mock("../helper.js", () => ({
	esbuildAsync: vi.fn(async () => {}),
	copyOpenNextConfig: vi.fn(),
	isEdgeRuntime: vi.fn(async () => false),
	getPackagePath: vi.fn(() => "build"),
}));

vi.mock("../installDeps.js", () => ({
	installDependencies: vi.fn(),
}));

vi.mock("../patch/codePatcher.js", () => ({
	applyCodePatches: vi.fn(async () => {}),
}));

vi.mock("../patch/patches/index.js", () => ({
	getEnvVarsPatch: vi.fn(() => ({ name: "env-vars", patches: [] })),
	patchNodeEnvironment: { name: "node-environment", patches: [] },
}));

vi.mock("node:fs", () => ({
	default: {
		mkdirSync: vi.fn(),
	},
	mkdirSync: vi.fn(),
}));

import type { NextAdapterOutputs } from "../../types/adapter.js";
import type { BuildOptions } from "../helper.js";
import * as buildHelper from "../helper.js";
import { installDependencies } from "../installDeps.js";
import { applyCodePatches } from "../patch/codePatcher.js";

import { buildExternalNodeMiddleware } from "./buildNodeMiddleware.js";

function createMockBuildOpts(overrides: Partial<BuildOptions> = {}): BuildOptions {
	return {
		appBuildOutputPath: "/app/build",
		appPackageJsonPath: "/app/package.json",
		appPath: "/app",
		appPublicPath: "/app/public",
		buildDir: "/app/.open-next/.build",
		config: {
			default: {},
			dangerous: {},
			middleware: { external: true },
		} as unknown as BuildOptions["config"],
		debug: false,
		minify: true,
		monorepoRoot: "/app",
		nextVersion: "16.0.0",
		openNextVersion: "0.1.0",
		openNextDistDir: "/fake/opennext/dist",
		outputDir: "/app/.open-next",
		packager: "npm" as const,
		tempBuildDir: "/tmp/open-next-tmp",
		...overrides,
	} as BuildOptions;
}

function createMockNextOutputs(): NextAdapterOutputs {
	return {
		pages: [],
		pagesApi: [],
		appPages: [],
		appRoutes: [],
		middleware: {
			pathname: "/",
			filePath: "/app/.next/server/middleware.js",
			assets: { "asset.txt": "/app/.next/server/asset.txt" },
		},
	};
}

describe("buildExternalNodeMiddleware", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("Case A: applies all default values when middlewareBundle is undefined", async () => {
		const options = createMockBuildOpts();
		const nextOutputs = createMockNextOutputs();

		await buildExternalNodeMiddleware(options, undefined, nextOutputs);

		// copyOpenNextConfig called with isEdge false (default isEdgeRuntime)
		expect(buildHelper.copyOpenNextConfig).toHaveBeenCalledWith(
			options.buildDir,
			"/app/.open-next/middleware",
			false
		);

		// esbuildAsync called with default external, banner, and static middleware import
		expect(buildHelper.esbuildAsync).toHaveBeenCalledTimes(1);
		const esbuildCall = vi.mocked(buildHelper.esbuildAsync).mock.calls[0];
		const esbuildOptions = esbuildCall[0];
		expect(esbuildOptions.external).toEqual(["./.next/*", "./build/.next/server/*"]);
		expect(esbuildOptions.define).toEqual({
			__OPEN_NEXT_NODE_MIDDLEWARE_PATH__: '"./build/.next/server/middleware.js"',
		});
		expect(esbuildOptions.banner?.js).toContain("globalThis.monorepoPackagePath");
		expect(esbuildOptions.banner?.js).not.toContain("globalThis.__middlewarePackagePath");
		expect(esbuildOptions.banner?.js).toContain("topLevelCreateRequire");

		// Core patches are applied once before the middleware is bundled.
		expect(applyCodePatches).toHaveBeenCalledTimes(1);
		expect(applyCodePatches).toHaveBeenCalledWith(
			options,
			["/app/.open-next/middleware/middleware.js"],
			{},
			expect.arrayContaining([expect.any(Object), expect.any(Object)])
		);

		// installDependencies called once
		expect(installDependencies).toHaveBeenCalledTimes(1);
	});

	test("Case B: forwards useEdgeConfig, externals, banner, additionalPlugins, additionalCodePatches", async () => {
		const options = createMockBuildOpts();
		const nextOutputs = createMockNextOutputs();
		const mockPlugin = { name: "user-supplied-plugin", setup: vi.fn() };
		const additionalPlugins = vi.fn(() => [mockPlugin]);
		const additionalCodePatches = [{ name: "user-patch", patches: [] }];

		await buildExternalNodeMiddleware(options, undefined, nextOutputs, {
			useEdgeConfig: true,
			externals: ["./something-else"],
			banner: ["// test banner"],
			additionalPlugins,
			additionalCodePatches,
		});

		// copyOpenNextConfig received useEdgeConfig=true (3rd arg)
		expect(buildHelper.copyOpenNextConfig).toHaveBeenCalledWith(
			options.buildDir,
			"/app/.open-next/middleware",
			true
		);

		// esbuildAsync called with user-supplied external and banner
		const esbuildCall = vi.mocked(buildHelper.esbuildAsync).mock.calls[0];
		const esbuildOptions = esbuildCall[0];
		expect(esbuildOptions.external).toEqual(["./something-else", "./build/.next/server/*"]);
		expect(esbuildOptions.banner?.js).toContain("// test banner");

		// additionalPlugins was invoked with (updater, nextOutputs)
		expect(additionalPlugins).toHaveBeenCalledTimes(1);
		expect(additionalPlugins).toHaveBeenCalledWith(expect.any(Object), nextOutputs);

		// plugins array contains mockPlugin and ends with updater.plugin
		const plugins = esbuildOptions.plugins as Array<{ name: string }>;
		expect(plugins).toContain(mockPlugin);
		expect(plugins[plugins.length - 1]).toEqual({
			name: "content-updater-mock",
			setup: expect.any(Function),
		});

		// Additional patches are added after the core pre-bundle patches.
		expect(applyCodePatches).toHaveBeenCalledTimes(1);
		const appliedPatches = vi.mocked(applyCodePatches).mock.calls[0][3];
		expect(appliedPatches).toEqual(expect.arrayContaining(additionalCodePatches));
		expect(appliedPatches).toHaveLength(3);
	});

	test("Case C: throws when nextOutputs has no middleware", async () => {
		const options = createMockBuildOpts();

		await expect(buildExternalNodeMiddleware(options, undefined, {})).rejects.toThrow(
			/without adapter outputs\.middleware/
		);
	});

	test("Case D: invokes banner function with 'middleware' name when banner is a function", async () => {
		const options = createMockBuildOpts();
		const nextOutputs = createMockNextOutputs();
		const bannerFn = vi.fn((name: string) => [`// banner for ${name}`]);

		await buildExternalNodeMiddleware(options, undefined, nextOutputs, {
			banner: bannerFn,
		});

		expect(bannerFn).toHaveBeenCalledWith("middleware");

		const esbuildCall = vi.mocked(buildHelper.esbuildAsync).mock.calls[0];
		const esbuildOptions = esbuildCall[0];
		expect(esbuildOptions.banner?.js).toContain("// banner for middleware");
	});
});
