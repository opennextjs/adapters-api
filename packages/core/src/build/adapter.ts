import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { Plugin } from "esbuild";

import { addDebugFile } from "../debug.js";
import logger from "../logger.js";
import type { ContentUpdater } from "../plugins/content-updater.js";
import type { BundleDefaults } from "../plugins/resolve.js";
import type { NextAdapterOutputs } from "../types/adapter.js";
import type { NextConfig } from "../types/next-types.js";
import type { OpenNextConfig } from "../types/open-next.js";

import { compileCache } from "./compileCache.js";
import { compileOpenNextConfig } from "./compileConfig.js";
import { compileTagCacheProvider } from "./compileTagCacheProvider.js";
import { createCacheAssets, createStaticAssets } from "./createAssets.js";
import { createCacheBundle } from "./createCacheBundle.js";
import { createImageOptimizationBundle } from "./createImageOptimizationBundle.js";
import { createMiddleware } from "./createMiddleware.js";
import { createRevalidationBundle } from "./createRevalidationBundle.js";
import { createServerBundle } from "./createServerBundle.js";
import { createWarmerBundle } from "./createWarmerBundle.js";
import { buildOpenNextOutput } from "./generateOutput.js";
import type { OpenNextOutput } from "./generateOutput.js";
import * as buildHelper from "./helper.js";
import type { CodePatcher } from "./patch/codePatcher.js";
import type { ValidateConfigResult } from "./validateConfig.js";

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
export type OpenNextAdapterOptions<T = OpenNextOutput> = {
	skipRevalidation?: boolean;
	skipImageOptimization?: boolean;
	skipWarmer?: boolean;
	skipCache?: boolean;
	skipGenerateOutput?: boolean;
	middlewareOptions?: { forceOnlyBuildOnce?: boolean };
	serverBundle: {
		additionalPlugins?: (updater: ContentUpdater, outputs: NextAdapterOutputs) => Plugin[];
		additionalCodePatches?: CodePatcher[];
		useEdgeConfig?: boolean;
		/**
		 * The esbuild externals for the server bundle. Every adapter has to declare
		 * them explicitly — there is no implicit default.
		 */
		externals: string[];
		banner?: string[] | ((name: string) => string[]);
	};
	beforeServerBundle?: (buildOpts: buildHelper.BuildOptions, config: OpenNextConfig) => Promise<void>;
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
	validateConfig?: (config: OpenNextConfig) => ValidateConfigResult | Promise<ValidateConfigResult>;
	generateOutput?: (buildOpts: buildHelper.BuildOptions) => Promise<T>;
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
export function buildAdapter<T = OpenNextOutput>(
	callback: (config: OpenNextConfig, buildOpts: buildHelper.BuildOptions) => OpenNextAdapterOptions<T>
): NextAdapter {
	// Closure-scoped state — no module-level mutable variables
	let buildOpts: buildHelper.BuildOptions;
	let config: OpenNextConfig;
	let adapterOptions: OpenNextAdapterOptions<T>;

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

			// Run adapter-level validate override (additional check; default already ran in compileOpenNextConfig)
			if (adapterOptions.validateConfig) {
				const result = await adapterOptions.validateConfig(config);
				if (!result.success) {
					if (result.shouldThrow) {
						throw new Error(result.message);
					}
					const level = result.level ?? "warn";
					logger[level](result.message);
				}
			}

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
			logger.info("OpenNext build will start now");

			// Step 1: Save debug output
			addDebugFile(buildOpts, "outputs.json", ctx);

			// Step 2: Call beforeServerBundle hook
			await adapterOptions.beforeServerBundle?.(buildOpts, config);

			const bundleDefaults = adapterOptions.defaultOverrides;

			// Step 3: Create middleware
			await createMiddleware(buildOpts, {
				...adapterOptions.middlewareOptions,
				defaultOverrides: bundleDefaults?.middleware,
			});
			console.log("Middleware created");

			// Step 4: Create static assets
			createStaticAssets(buildOpts);
			console.log("Static assets created");

			// Step 5: Cache assets
			if (buildOpts.config.dangerous?.disableIncrementalCache !== true) {
				const { shouldUseTagCache } = createCacheAssets(buildOpts);
				console.log("Cache assets created");
				if (shouldUseTagCache) {
					await compileTagCacheProvider(buildOpts, bundleDefaults?.tagCache);
					console.log("Tag cache provider compiled");
				}
			}

			// Step 6: Build wrapped additionalPlugins
			const serverBundle = adapterOptions.serverBundle;
			const wrappedAdditionalPlugins = serverBundle.additionalPlugins
				? (updater: ContentUpdater) => serverBundle.additionalPlugins!(updater, ctx.outputs)
				: undefined;

			// Step 7: Create server bundle
			await createServerBundle(
				buildOpts,
				{
					additionalPlugins: wrappedAdditionalPlugins,
					additionalCodePatches: serverBundle.additionalCodePatches,
					useEdgeConfig: serverBundle.useEdgeConfig,
					externals: serverBundle.externals,
					banner: serverBundle.banner,
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

			// Step 11: Cache bundle
			if (!adapterOptions.skipCache && config.dangerous?.disableIncrementalCache !== true) {
				await createCacheBundle(buildOpts, bundleDefaults?.cache);
				console.log("Cache bundle created");
			}

			// Step 12: Warmer bundle
			if (!adapterOptions.skipWarmer) {
				await createWarmerBundle(buildOpts, bundleDefaults?.warmer);
				console.log("Warmer bundle created");
			}

			// Step 13: Generate output
			if (!adapterOptions.skipGenerateOutput) {
				const output = adapterOptions.generateOutput
					? await adapterOptions.generateOutput(buildOpts)
					: await buildOpenNextOutput(buildOpts, { skipCache: adapterOptions.skipCache });
				fs.writeFileSync(
					path.join(buildOpts.appBuildOutputPath, ".open-next", "open-next.output.json"),
					JSON.stringify(output)
				);
				console.log("Output generated");
			}
		},
	};
}
