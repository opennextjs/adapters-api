import fs from "node:fs";
import path from "node:path";

import logger from "../logger.js";
import type { DefaultOverrides } from "../plugins/resolve.js";
import { openNextResolvePlugin } from "../plugins/resolve.js";

import * as buildHelper from "./helper.js";

/**
 * Builds the deployable and in-process cache handler entrypoints.
 *
 * @param options Normalized build options.
 * @param defaultOverrides Adapter defaults for the cache function.
 * @return A promise that resolves when both entrypoints are bundled.
 */
export async function createCacheBundle(
	options: buildHelper.BuildOptions,
	defaultOverrides?: DefaultOverrides
) {
	logger.info("Bundling cache function...");

	const { config, outputDir } = options;

	// Create output folder
	const outputPath = path.join(outputDir, "cache-function");
	fs.mkdirSync(outputPath, { recursive: true });

	// Copy open-next.config.mjs into the bundle
	buildHelper.copyOpenNextConfig(options.buildDir, outputPath);

	// Build the wrapped deployment entrypoint and raw in-process handler.
	await buildHelper.esbuildAsync(
		{
			external: ["next"],
			entryPoints: {
				index: path.join(options.openNextDistDir, "adapters", "cache-adapter.js"),
				handler: path.join(options.openNextDistDir, "adapters", "cache-handler.js"),
			},
			outdir: outputPath,
			outExtension: { ".js": ".mjs" },
			plugins: [
				openNextResolvePlugin({
					fnName: "cache",
					overrides: {
						converter: config.cacheHandler?.override?.converter,
						wrapper: config.cacheHandler?.override?.wrapper,
						incrementalCache: config.cacheHandler?.incrementalCache,
						tagCache: config.cacheHandler?.tagCache,
						cdnInvalidation: config.cacheHandler?.cdnInvalidation ?? config.default.override?.cdnInvalidation,
					},
					defaultOverrides: {
						converter: defaultOverrides?.converter ?? "node",
						wrapper: defaultOverrides?.wrapper,
						incrementalCache: defaultOverrides?.incrementalCache,
						tagCache: defaultOverrides?.tagCache,
						cdnInvalidation: defaultOverrides?.cdnInvalidation,
					},
				}),
			],
		},
		options
	);
}
