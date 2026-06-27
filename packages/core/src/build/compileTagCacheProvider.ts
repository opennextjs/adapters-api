import path from "node:path";

import type { DefaultOverrides } from "../plugins/resolve.js";
import { openNextResolvePlugin } from "../plugins/resolve.js";

import * as buildHelper from "./helper.js";
import { installDependencies } from "./installDeps.js";

export async function compileTagCacheProvider(
	options: buildHelper.BuildOptions,
	defaultOverrides?: DefaultOverrides
) {
	const providerPath = path.join(options.outputDir, "dynamodb-provider");

	const overrides = options.config.initializationFunction?.override;

	await buildHelper.esbuildAsync(
		{
			external: ["@aws-sdk/client-dynamodb"],
			entryPoints: [path.join(options.openNextDistDir, "adapters", "dynamo-provider.js")],
			outfile: path.join(providerPath, "index.mjs"),
			target: ["node18"],
			plugins: [
				openNextResolvePlugin({
					fnName: "initializationFunction",
					overrides: {
						converter: overrides?.converter,
						wrapper: overrides?.wrapper,
						tagCache: options.config.initializationFunction?.tagCache,
					},
					defaultOverrides: {
						converter: defaultOverrides?.converter ?? "dummy",
						wrapper: defaultOverrides?.wrapper,
						tagCache: defaultOverrides?.tagCache,
					},
				}),
			],
		},
		options
	);

	installDependencies(providerPath, options.config.initializationFunction?.install);
}
