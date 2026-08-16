import fs from "node:fs";
import path from "node:path";

import logger from "../logger.js";
import type { DefaultOverrides } from "../plugins/resolve.js";
import { openNextResolvePlugin } from "../plugins/resolve.js";

import * as buildHelper from "./helper.js";

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

	// Build Lambda code
	await buildHelper.esbuildAsync(
		{
			external: ["next"],
			entryPoints: [path.join(options.openNextDistDir, "adapters", "cache-adapter.js")],
			outfile: path.join(outputPath, "index.mjs"),
			plugins: [
				openNextResolvePlugin({
					fnName: "cache",
					overrides: {
						converter: config.cacheHandler?.override?.converter,
						wrapper: config.cacheHandler?.override?.wrapper,
						incrementalCache: config.cacheHandler?.incrementalCache,
						tagCache: config.cacheHandler?.tagCache,
						cdnInvalidation: config.cacheHandler?.cdnInvalidation,
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
