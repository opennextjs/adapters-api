import fs from "node:fs";
import path from "node:path";

import logger from "../logger.js";
import type { DefaultOverrides } from "../plugins/resolve.js";
import { openNextResolvePlugin } from "../plugins/resolve.js";

import * as buildHelper from "./helper.js";
import { installDependencies } from "./installDeps.js";

export async function createWarmerBundle(
	options: buildHelper.BuildOptions,
	defaultOverrides?: DefaultOverrides
) {
	logger.info("Bundling warmer function...");

	const { config, outputDir } = options;

	// Create output folder
	const outputPath = path.join(outputDir, "warmer-function");
	fs.mkdirSync(outputPath, { recursive: true });

	// Copy open-next.config.mjs into the bundle
	buildHelper.copyOpenNextConfig(options.buildDir, outputPath);

	// Build Lambda code
	// note: bundle in OpenNext package b/c the adatper relys on the
	//       "serverless-http" package which is not a dependency in user's
	//       Next.js app.
	await buildHelper.esbuildAsync(
		{
			entryPoints: [path.join(options.openNextDistDir, "adapters", "warmer-function.js")],
			external: ["next"],
			outfile: path.join(outputPath, "index.mjs"),
			plugins: [
				openNextResolvePlugin({
					overrides: {
						converter: config.warmer?.override?.converter,
						wrapper: config.warmer?.override?.wrapper,
					},
					defaultOverrides: {
						converter: defaultOverrides?.converter ?? "dummy",
						wrapper: defaultOverrides?.wrapper,
					},
					fnName: "warmer",
				}),
			],
			banner: {
				js: [
					"import { createRequire as topLevelCreateRequire } from 'module';",
					"const require = topLevelCreateRequire(import.meta.url);",
					"import bannerUrl from 'url';",
					"const __dirname = bannerUrl.fileURLToPath(new URL('.', import.meta.url));",
				].join(""),
			},
		},
		options
	);

	installDependencies(outputPath, config.warmer?.install);
}
