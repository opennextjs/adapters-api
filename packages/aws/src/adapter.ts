import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { compileCache } from "@opennextjs/core/build/compileCache.js";
import { compileOpenNextConfig } from "@opennextjs/core/build/compileConfig.js";
import { compileTagCacheProvider } from "@opennextjs/core/build/compileTagCacheProvider.js";
import { createCacheAssets, createStaticAssets } from "@opennextjs/core/build/createAssets.js";
import { createImageOptimizationBundle } from "@opennextjs/core/build/createImageOptimizationBundle.js";
import { createMiddleware } from "@opennextjs/core/build/createMiddleware.js";
import { createRevalidationBundle } from "@opennextjs/core/build/createRevalidationBundle.js";
import { createServerBundle } from "@opennextjs/core/build/createServerBundle.js";
import { createWarmerBundle } from "@opennextjs/core/build/createWarmerBundle.js";
import { generateOutput } from "@opennextjs/core/build/generateOutput.js";
import * as buildHelper from "@opennextjs/core/build/helper.js";
import { addDebugFile } from "@opennextjs/core/debug.js";
import type { ContentUpdater } from "@opennextjs/core/plugins/content-updater.js";
import { externalChunksPlugin, inlineRouteHandler } from "@opennextjs/core/plugins/inlineRouteHandlers.js";
import type { NextConfig } from "@opennextjs/core/types/next-types.js";

export type NextAdapterOutput = {
	pathname: string;
	filePath: string;
	assets: Record<string, unknown>;
};

export type NextAdapterOutputs = {
	pages: NextAdapterOutput[];
	pagesApi: NextAdapterOutput[];
	appPages: NextAdapterOutput[];
	appRoutes: NextAdapterOutput[];
	middleware?: NextAdapterOutput;
};

type NextAdapter = {
	name: string;
	modifyConfig: (config: NextConfig, { phase }: { phase: string }) => Promise<NextConfig>;
	onBuildComplete: (props: {
		routes: unknown;
		outputs: NextAdapterOutputs;
		projectDir: string;
		repoRoot: string;
		distDir: string;
		config: NextConfig;
		nextVersion: string;
	}) => Promise<void>;
}; //TODO: use the one provided by Next

let buildOpts: buildHelper.BuildOptions;

export default {
	name: "OpenNext",
	async modifyConfig(nextConfig, { phase }) {
		// We have to precompile the cache here, probably compile OpenNext config as well
		const { config, buildDir } = await compileOpenNextConfig("open-next.config.ts", {
			nodeExternals: undefined,
		});

		const require = createRequire(import.meta.url);
		//TODO: change that
		const openNextDistDir = path.dirname(require.resolve("@opennextjs/core/debug.js"));

		buildOpts = buildHelper.normalizeOptions(config, openNextDistDir, buildDir);

		buildHelper.initOutputDir(buildOpts);

		const cache = compileCache(buildOpts);

		const packagePath = buildHelper.getPackagePath(buildOpts);

		// We then have to copy the cache files to the .next dir so that they are available at runtime
		//TODO: use a better path, this one is temporary just to make it work
		const tempCachePath = path.join(
			buildOpts.outputDir,
			"server-functions/default",
			packagePath,
			".open-next/.build"
		);
		fs.mkdirSync(tempCachePath, { recursive: true });
		fs.copyFileSync(cache.cache, path.join(tempCachePath, "cache.cjs"));
		fs.copyFileSync(cache.composableCache, path.join(tempCachePath, "composable-cache.cjs"));

		//TODO: We should check the version of Next here, below 16 we'd throw or show a warning
		return {
			...nextConfig,
			cacheHandler: cache.cache, //TODO: compute that here,
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
	async onBuildComplete(outputs) {
		console.log("OpenNext build will start now");

		// TODO(vicb): save outputs
		addDebugFile(buildOpts, "outputs.json", outputs);

		// Compile middleware
		await createMiddleware(buildOpts);
		console.log("Middleware created");

		createStaticAssets(buildOpts);
		console.log("Static assets created");

		if (buildOpts.config.dangerous?.disableIncrementalCache !== true) {
			const { useTagCache } = createCacheAssets(buildOpts);
			console.log("Cache assets created");
			if (useTagCache) {
				await compileTagCacheProvider(buildOpts);
				console.log("Tag cache provider compiled");
			}
		}

		await createServerBundle(
			buildOpts,
			{
				additionalPlugins: getAdditionalPluginsFactory(buildOpts, outputs.outputs),
			},
			outputs.outputs
		);

		console.log("Server bundle created");
		await createRevalidationBundle(buildOpts);
		console.log("Revalidation bundle created");
		await createImageOptimizationBundle(buildOpts);
		console.log("Image optimization bundle created");
		await createWarmerBundle(buildOpts);
		console.log("Warmer bundle created");
		await generateOutput(buildOpts);
		console.log("Output generated");
	},
} satisfies NextAdapter;

function getAdditionalPluginsFactory(buildOpts: buildHelper.BuildOptions, outputs: NextAdapterOutputs) {
	//TODO: we should make this a property of buildOpts
	const packagePath = buildHelper.getPackagePath(buildOpts);
	return (updater: ContentUpdater) => [
		inlineRouteHandler(updater, outputs, packagePath),
		externalChunksPlugin(outputs, packagePath),
	];
}
