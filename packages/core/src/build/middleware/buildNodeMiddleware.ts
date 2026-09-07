import fs from "node:fs";
import path from "node:path";

import type { NextAdapterOutputs } from "@/types/adapter.js";
import type { IncludedOriginResolver, LazyLoadedOverride, OverrideOptions } from "@/types/open-next.js";
import type { OriginResolver } from "@/types/overrides.js";

import { ContentUpdater } from "../../plugins/content-updater.js";
import { openNextExternalMiddlewarePlugin } from "../../plugins/externalMiddleware.js";
import type { DefaultOverrides } from "../../plugins/resolve.js";
import { openNextResolvePlugin } from "../../plugins/resolve.js";
import { normalizePath } from "../../utils/normalize-path.js";
import type { OpenNextAdapterOptions } from "../adapter.js";
import { copyAdapterFiles } from "../copyAdapterFiles.js";
import * as buildHelper from "../helper.js";
import { installDependencies } from "../installDeps.js";
import { applyCodePatches } from "../patch/codePatcher.js";
import * as patches from "../patch/patches/index.js";

type Override = OverrideOptions & {
	originResolver?: LazyLoadedOverride<OriginResolver> | IncludedOriginResolver;
};

type MiddlewareBundle = NonNullable<OpenNextAdapterOptions["middlewareBundle"]>;

/**
 * Builds a standalone Node.js middleware function.
 *
 * @param options Normalized OpenNext build options.
 * @param defaultOverrides Provider-specific override defaults.
 * @param nextOutputs Outputs emitted by the Next.js adapter build.
 * @param middlewareBundle Provider-specific middleware bundle customization.
 * @returns A promise that resolves when the bundle is written.
 * @throws When external middleware is disabled or its adapter output is missing.
 */
export async function buildExternalNodeMiddleware(
	options: buildHelper.BuildOptions,
	defaultOverrides?: DefaultOverrides,
	nextOutputs?: NextAdapterOutputs,
	middlewareBundle?: MiddlewareBundle
) {
	const { config, outputDir } = options;
	if (!config.middleware?.external) {
		throw new Error("This function should only be called for external middleware");
	}
	const outputPath = path.join(outputDir, "middleware");
	fs.mkdirSync(outputPath, { recursive: true });
	fs.mkdirSync(path.join(outputPath, ".next"), { recursive: true });
	fs.copyFileSync(
		path.join(options.appBuildOutputPath, ".next", "open-next-routing.json"),
		path.join(outputPath, ".next", "open-next-routing.json")
	);

	// Copy open-next.config.mjs
	const useEdgeConfig =
		middlewareBundle?.useEdgeConfig ?? (await buildHelper.isEdgeRuntime(config.middleware.override));
	buildHelper.copyOpenNextConfig(options.buildDir, outputPath, useEdgeConfig);
	const overrides = {
		...config.middleware.override,
		originResolver: config.middleware.originResolver,
	};
	const packagePath = buildHelper.getPackagePath(options);
	const middlewareImportPath = `./${packagePath ? `${normalizePath(packagePath)}/` : ""}.next/server/middleware.js`;
	const middlewareExternal = `${middlewareImportPath.slice(0, -"middleware.js".length)}*`;

	if (!nextOutputs?.middleware) {
		throw new Error(
			"buildExternalNodeMiddleware was called without adapter outputs.middleware. " +
				"Ensure the adapter provides NextAdapterOutputs.middleware."
		);
	}

	console.log("Copying adapter files for external middleware...");
	const tracedFiles = await copyAdapterFiles(
		options,
		"middleware",
		packagePath,
		{ pages: [], pagesApi: [], appPages: [], appRoutes: [], middleware: nextOutputs.middleware },
		outputPath
	);

	function override<T extends keyof Override>(target: T) {
		return typeof overrides?.[target] === "string" ? overrides[target] : undefined;
	}

	await applyCodePatches(
		options,
		tracedFiles,
		{} as ReturnType<typeof import("../copyTracedFiles.js").getManifests>,
		[
			patches.getEnvVarsPatch(options),
			patches.patchNodeEnvironment,
			...(middlewareBundle?.additionalCodePatches ?? []),
		]
	);

	const updater = new ContentUpdater(options);
	const additionalPlugins = middlewareBundle?.additionalPlugins
		? middlewareBundle.additionalPlugins(updater, nextOutputs)
		: [];
	const defaultBanner = [
		`globalThis.monorepoPackagePath = '${normalizePath(packagePath)}';`,
		"import process from 'node:process';",
		"import { Buffer } from 'node:buffer';",
		"import { AsyncLocalStorage } from 'node:async_hooks';",
		"import { createRequire as topLevelCreateRequire } from 'module';",
		"const require = topLevelCreateRequire(import.meta.url);",
		"import bannerUrl from 'url';",
		"const __dirname = bannerUrl.fileURLToPath(new URL('.', import.meta.url));",
	];
	const bannerLines =
		typeof middlewareBundle?.banner === "function"
			? middlewareBundle.banner("middleware")
			: (middlewareBundle?.banner ?? defaultBanner);

	// Bundle middleware
	await buildHelper.esbuildAsync(
		{
			entryPoints: [path.join(options.openNextDistDir, "adapters", "middleware.js")],
			outfile: path.join(outputPath, "handler.mjs"),
			external: [...(middlewareBundle?.externals ?? ["./.next/*"]), middlewareExternal],
			define: {
				__OPEN_NEXT_NODE_MIDDLEWARE_PATH__: JSON.stringify(middlewareImportPath),
			},
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
				...additionalPlugins,
				// The content updater plugin must be the last plugin
				updater.plugin,
			],
			banner: {
				js: bannerLines.join(""),
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
			define: {
				__OPEN_NEXT_NODE_MIDDLEWARE_PATH__: JSON.stringify("./.next/server/middleware.js"),
			},
			outfile: path.join(options.buildDir, "middleware.mjs"),
			bundle: true,
			platform: "node",
		},
		options
	);
}
