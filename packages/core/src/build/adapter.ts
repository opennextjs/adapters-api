import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { Plugin } from "esbuild";

import { addDebugFile } from "../debug.js";
import type { ContentUpdater } from "../plugins/content-updater.js";
import type { BundleDefaults } from "../plugins/resolve.js";
import type { NextAdapterOutputs } from "../types/adapter.js";
import type { NextConfig } from "../types/next-types.js";
import type { OpenNextConfig } from "../types/open-next.js";

import { compileCache } from "./compileCache.js";
import { compileOpenNextConfig } from "./compileConfig.js";
import { compileTagCacheProvider } from "./compileTagCacheProvider.js";
import { createCacheAssets, createStaticAssets } from "./createAssets.js";
import { createImageOptimizationBundle } from "./createImageOptimizationBundle.js";
import { createMiddleware } from "./createMiddleware.js";
import { createRevalidationBundle } from "./createRevalidationBundle.js";
import { createServerBundle } from "./createServerBundle.js";
import { createWarmerBundle } from "./createWarmerBundle.js";
import { generateOutput } from "./generateOutput.js";
import * as buildHelper from "./helper.js";
import type { CodePatcher } from "./patch/codePatcher.js";

const require = createRequire(import.meta.url);

/**
 * The parameter type for onBuildComplete.
 */
export type BuildCompleteContext = {
	routes: unknown;
	outputs: NextAdapterOutputs;
	projectDir: string;
	repoRoot: string;
	distDir: string;
	config: NextConfig;
	nextVersion: string;
};

/**
 * The return type of buildAdapter — the adapter interface that Next.js consumes.
 */
export type NextAdapter = {
	name: string;
	modifyConfig: (config: NextConfig, { phase }: { phase: string }) => Promise<NextConfig>;
	onBuildComplete: (props: BuildCompleteContext) => Promise<void>;
};

/**
 * The influence an adapter can exert on the build process, returned by the callback.
 */
export type OpenNextAdapterOptions = {
	skipRevalidation?: boolean;
	skipImageOptimization?: boolean;
	skipWarmer?: boolean;
	skipGenerateOutput?: boolean;
	middlewareOptions?: { forceOnlyBuildOnce?: boolean };
	serverBundle?: {
		additionalPlugins?: (updater: ContentUpdater, outputs: NextAdapterOutputs) => Plugin[];
		additionalCodePatches?: CodePatcher[];
		useEdgeConfig?: boolean;
		externals?: string[];
		banner?: string[] | ((name: string) => string[]);
	};
	beforeMiddleware?: (buildOpts: buildHelper.BuildOptions, config: OpenNextConfig) => Promise<void>;
	afterServerBundle?: (buildOpts: buildHelper.BuildOptions, config: OpenNextConfig) => Promise<void>;
	tempCachePath?: (buildOpts: buildHelper.BuildOptions, packagePath: string) => string;
	/**
	 * Bundle-specific default override names applied when the user's
	 * open-next.config.ts does not specify an override for a given key.
	 * Each bundle type (server, middleware, edge, imageOptimization,
	 * revalidation, warmer, tagCache) can have its own separate defaults map.
	 * Precedence: config override > platform default > core node default.
	 */
	defaultOverrides?: BundleDefaults;
};

/**
 * Creates a NextAdapter that orchestrates the OpenNext build pipeline.
 *
 * This function eliminates duplicated build logic across platform-specific adapters
 * (AWS, Cloudflare, etc.) by centralizing the build orchestration in core.
 *
 * @param callback - A function that receives the OpenNext config and build options,
 *                   returning adapter-specific influence over the build process.
 * @returns A NextAdapter with modifyConfig and onBuildComplete hooks.
 */
export function buildAdapter(
	callback: (config: OpenNextConfig, buildOpts: buildHelper.BuildOptions) => OpenNextAdapterOptions
): NextAdapter {
	// Closure-scoped state — no module-level mutable variables
	let buildOpts: buildHelper.BuildOptions;
	let config: OpenNextConfig;
	let adapterOptions: OpenNextAdapterOptions;

	return {
		name: "OpenNext",

		async modifyConfig(nextConfig, { phase: _phase }) {
			// Step 1: Compile OpenNext config with edge support, fallback on failure
			let result: { config: OpenNextConfig; buildDir: string };
			try {
				result = await compileOpenNextConfig("open-next.config.ts", { compileEdge: true });
			} catch (error) {
				console.warn(
					"Failed to compile open-next.config.ts for edge runtime, falling back to node-only compilation.",
					error instanceof Error ? error.message : error
				);
				result = await compileOpenNextConfig("open-next.config.ts", { compileEdge: false });
			}

			config = result.config;
			const buildDir = result.buildDir;

			// Step 2: Resolve openNextDistDir
			const openNextDistDir = path.dirname(require.resolve("@opennextjs/core/debug.js"));

			// Step 3: Normalize options
			buildOpts = buildHelper.normalizeOptions(config, openNextDistDir, buildDir);

			// Step 4: Initialize output directory
			buildHelper.initOutputDir(buildOpts);

			// Step 5: Compile cache
			const cache = compileCache(buildOpts);

			// Step 6: Call the adapter callback to get influence
			adapterOptions = callback(config, buildOpts);

			// Step 7: Build tempCachePath
			const packagePath = buildHelper.getPackagePath(buildOpts);
			const tempCachePath =
				adapterOptions.tempCachePath?.(buildOpts, packagePath) ??
				path.join(buildOpts.outputDir, "server-functions/default", packagePath, ".open-next/.build");

			// Step 8: Copy cache files
			fs.mkdirSync(tempCachePath, { recursive: true });
			fs.copyFileSync(cache.cache, path.join(tempCachePath, "cache.cjs"));
			fs.copyFileSync(cache.composableCache, path.join(tempCachePath, "composable-cache.cjs"));

			// Step 10: Return modified nextConfig
			return {
				...nextConfig,
				cacheHandler: cache.cache,
				cacheHandlers: {
					default: cache.composableCache,
					remote: cache.composableCache,
				},
				cacheMaxMemorySize: 0,
				experimental: {
					...nextConfig.experimental,
					trustHostHeader: true,
				},
			};
		},

		async onBuildComplete(ctx) {
			console.log("OpenNext build will start now");

			// Step 1: Save debug output
			addDebugFile(buildOpts, "outputs.json", ctx);

			// Step 2: Call beforeMiddleware hook
			await adapterOptions.beforeMiddleware?.(buildOpts, config);

			const bundleDefaults = adapterOptions.defaultOverrides;

			// Step 3: Create middleware
			await createMiddleware(buildOpts, { ...adapterOptions.middlewareOptions, defaultOverrides: bundleDefaults?.middleware });
			console.log("Middleware created");

			// Step 4: Create static assets
			createStaticAssets(buildOpts);
			console.log("Static assets created");

			// Step 5: Cache assets
			if (buildOpts.config.dangerous?.disableIncrementalCache !== true) {
				const { useTagCache } = createCacheAssets(buildOpts);
				console.log("Cache assets created");
				if (useTagCache) {
					await compileTagCacheProvider(buildOpts, bundleDefaults?.tagCache);
					console.log("Tag cache provider compiled");
				}
			}

			// Step 6: Build wrapped additionalPlugins
			const wrappedAdditionalPlugins = adapterOptions.serverBundle?.additionalPlugins
				? (updater: ContentUpdater) => adapterOptions.serverBundle!.additionalPlugins!(updater, ctx.outputs)
				: undefined;

			// Step 7: Create server bundle
			await createServerBundle(
				buildOpts,
				{
					additionalPlugins: wrappedAdditionalPlugins,
					additionalCodePatches: adapterOptions.serverBundle?.additionalCodePatches,
					useEdgeConfig: adapterOptions.serverBundle?.useEdgeConfig,
					externals: adapterOptions.serverBundle?.externals,
					banner: adapterOptions.serverBundle?.banner,
					bundleDefaults,
				},
				ctx.outputs
			);
			console.log("Server bundle created");

			// Step 8: Call afterServerBundle hook
			await adapterOptions.afterServerBundle?.(buildOpts, config);

			// Step 9: Revalidation bundle
			if (!adapterOptions.skipRevalidation) {
				await createRevalidationBundle(buildOpts, bundleDefaults?.revalidation);
				console.log("Revalidation bundle created");
			}

			// Step 10: Image optimization bundle
			if (!adapterOptions.skipImageOptimization) {
				await createImageOptimizationBundle(buildOpts, bundleDefaults?.imageOptimization);
				console.log("Image optimization bundle created");
			}

			// Step 11: Warmer bundle
			if (!adapterOptions.skipWarmer) {
				await createWarmerBundle(buildOpts, bundleDefaults?.warmer);
				console.log("Warmer bundle created");
			}

			// Step 12: Generate output
			if (!adapterOptions.skipGenerateOutput) {
				await generateOutput(buildOpts);
				console.log("Output generated");
			}
		},
	};
}
