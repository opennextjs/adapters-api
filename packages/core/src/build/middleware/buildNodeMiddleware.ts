import fs from "node:fs";
import path from "node:path";

import type { IncludedOriginResolver, LazyLoadedOverride, OverrideOptions } from "@/types/open-next.js";
import type { OriginResolver } from "@/types/overrides.js";
import { getCrossPlatformPathRegex } from "@/utils/regex.js";

import { openNextExternalMiddlewarePlugin } from "../../plugins/externalMiddleware.js";
import { openNextReplacementPlugin } from "../../plugins/replacement.js";
import type { DefaultOverrides } from "../../plugins/resolve.js";
import { openNextResolvePlugin } from "../../plugins/resolve.js";
import { copyTracedFiles } from "../copyTracedFiles.js";
import * as buildHelper from "../helper.js";
import { installDependencies } from "../installDeps.js";

type Override = OverrideOptions & {
	originResolver?: LazyLoadedOverride<OriginResolver> | IncludedOriginResolver;
};

export async function buildExternalNodeMiddleware(
	options: buildHelper.BuildOptions,
	defaultOverrides?: DefaultOverrides
) {
	const { appBuildOutputPath, config, outputDir } = options;
	if (!config.middleware?.external) {
		throw new Error("This function should only be called for external middleware");
	}
	const outputPath = path.join(outputDir, "middleware");
	fs.mkdirSync(outputPath, { recursive: true });

	// Copy open-next.config.mjs
	buildHelper.copyOpenNextConfig(
		options.buildDir,
		outputPath,
		await buildHelper.isEdgeRuntime(config.middleware.override)
	);
	const overrides = {
		...config.middleware.override,
		originResolver: config.middleware.originResolver,
	};
	const packagePath = buildHelper.getPackagePath(options);

	// TODO: change this so that we don't copy unnecessary files
	await copyTracedFiles({
		buildOutputPath: appBuildOutputPath,
		packagePath,
		outputDir: outputPath,
		routes: [],
		skipServerFiles: true,
	});

	function override<T extends keyof Override>(target: T) {
		return typeof overrides?.[target] === "string" ? overrides[target] : undefined;
	}

	// Bundle middleware
	await buildHelper.esbuildAsync(
		{
			entryPoints: [path.join(options.openNextDistDir, "adapters", "middleware.js")],
			outfile: path.join(outputPath, "handler.mjs"),
			external: ["./.next/*"],
			platform: "node",
			plugins: [
				openNextResolvePlugin({
					overrides: {
						wrapper: override("wrapper"),
						converter: override("converter"),
						tagCache: override("tagCache"),
						incrementalCache: override("incrementalCache"),
						queue: override("queue"),
						originResolver: override("originResolver"),
						proxyExternalRequest: override("proxyExternalRequest"),
					},
					defaultOverrides: {
						wrapper: defaultOverrides?.wrapper ?? "@opennextjs/core/overrides/wrappers/node.js",
						converter: defaultOverrides?.converter ?? "@opennextjs/core/overrides/converters/node.js",
						tagCache: defaultOverrides?.tagCache ?? "@opennextjs/core/overrides/tagCache/dummy.js",
						incrementalCache:
							defaultOverrides?.incrementalCache ?? "@opennextjs/core/overrides/incrementalCache/dummy.js",
						queue: defaultOverrides?.queue ?? "@opennextjs/core/overrides/queue/direct.js",
						originResolver:
							defaultOverrides?.originResolver ?? "@opennextjs/core/overrides/originResolver/pattern-env.js",
						proxyExternalRequest:
							defaultOverrides?.proxyExternalRequest ??
							"@opennextjs/core/overrides/proxyExternalRequest/node.js",
					},
					fnName: "middleware",
				}),
				openNextExternalMiddlewarePlugin(
					path.join(options.openNextDistDir, "core", "nodeMiddlewareHandler.js")
				),
			],
			banner: {
				js: [
					`globalThis.monorepoPackagePath = '${packagePath}';`,
					"import process from 'node:process';",
					"import { Buffer } from 'node:buffer';",
					"import { AsyncLocalStorage } from 'node:async_hooks';",
					"import { createRequire as topLevelCreateRequire } from 'module';",
					"const require = topLevelCreateRequire(import.meta.url);",
					"import bannerUrl from 'url';",
					"const __dirname = bannerUrl.fileURLToPath(new URL('.', import.meta.url));",
				].join(""),
			},
		},
		options
	);

	// Do we need to copy or do something with env file here?

	installDependencies(outputPath, config.middleware?.install);
}

export async function buildBundledNodeMiddleware(options: buildHelper.BuildOptions) {
	await buildHelper.esbuildAsync(
		{
			entryPoints: [path.join(options.openNextDistDir, "core/nodeMiddlewareHandler.js")],
			external: ["./.next/*"],
			outfile: path.join(options.buildDir, "middleware.mjs"),
			bundle: true,
			platform: "node",
		},
		options
	);
}
