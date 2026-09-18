/* oxlint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAdapter } from "@opennextjs/core/build/adapter.js";
import type { BuildOptions } from "@opennextjs/core/build/helper.js";
import * as buildHelper from "@opennextjs/core/build/helper.js";
import type { ContentUpdater } from "@opennextjs/core/plugins/content-updater.js";
import { openNextEdgePlugins } from "@opennextjs/core/plugins/edge.js";
import { openNextExternalMiddlewarePlugin } from "@opennextjs/core/plugins/externalMiddleware.js";
import { inlineRouteHandler } from "@opennextjs/core/plugins/inlineRouteHandlers.js";
import type { NextAdapterOutputs } from "@opennextjs/core/types/adapter.js";
import type { OpenNextConfig } from "@opennextjs/core/types/open-next.js";
import { normalizePath } from "@opennextjs/core/utils/normalize-path.js";

import { bundleServer } from "./build/bundle-server.js";
import { compileEnvFiles } from "./build/open-next/compile-env-files.js";
import { compileImages } from "./build/open-next/compile-images.js";
import { compileInit } from "./build/open-next/compile-init.js";
import { compileSkewProtection } from "./build/open-next/compile-skew-protection.js";
import { compileContainer } from "./build/open-next/compileContainer.js";
import { compileDurableObjects } from "./build/open-next/compileDurableObjects.js";
import { patchWebpackMiddlewareRuntime } from "./build/patches/ast/webpack-runtime.js";
import { inlineLoadManifest } from "./build/patches/plugins/load-manifest.js";
import { patchOpenTelemetryGlobalUtils } from "./build/patches/plugins/opentelemetry.js";
import { patchResRevalidate } from "./build/patches/plugins/res-revalidate.js";
import { patchTurbopackRuntime } from "./build/patches/plugins/turbopack.js";
import { patchUseCacheIO } from "./build/patches/plugins/use-cache.js";
import { copyPackageCliFiles } from "./build/utils/copy-package-cli-files.js";

export default buildAdapter((config: OpenNextConfig, buildOpts: BuildOptions) => {
	const isContainer =
		(config as OpenNextConfig & { cloudflare?: { container?: boolean } }).cloudflare?.container === true;
	const packagePath = buildHelper.getPackagePath(buildOpts);
	return {
		skipRevalidation: true,
		skipImageOptimization: true,
		skipWarmer: true,
		skipGenerateOutput: true,
		middlewareOptions: { forceOnlyBuildOnce: true },
		beforeServerBundle: async (buildOpts, _config) => {
			// Import edge-compiled config for skew protection
			const configPath = path.join(
				buildOpts.appBuildOutputPath,
				".open-next/.build/open-next.config.edge.mjs"
			);
			const openNextConfig = fs.existsSync(configPath)
				? await import(configPath).then((mod) => mod.default)
				: config; // fallback to node config
			compileEnvFiles(buildOpts);
			await compileInit(buildOpts, {} as any);
			await compileImages(buildOpts);
			await compileSkewProtection(buildOpts, openNextConfig);
		},
		serverBundle: {
			useEdgeConfig: !isContainer,
			externals: ["./middleware.mjs"],
			banner: (name: string) => {
				const banner = [`globalThis.monorepoPackagePath = "${normalizePath(packagePath)}";`];
				if (isContainer) {
					banner.push(
						"import process from 'node:process';",
						"import { Buffer } from 'node:buffer';",
						"import { AsyncLocalStorage as NodeAsyncLocalStorage } from 'node:async_hooks';",
						"globalThis.AsyncLocalStorage = NodeAsyncLocalStorage;",
						"import { createRequire as topLevelCreateRequire } from 'module';",
						"const require = topLevelCreateRequire(import.meta.url);",
						"import bannerUrl from 'url';",
						"const __dirname = bannerUrl.fileURLToPath(new URL('.', import.meta.url));",
						"const __filename = bannerUrl.fileURLToPath(import.meta.url);"
					);
				}
				banner.push(name === "default" ? "" : `globalThis.fnName = "${name}";`);
				return banner;
			},
			additionalPlugins: (updater: ContentUpdater, outputs: NextAdapterOutputs) => [
				inlineRouteHandler(updater, outputs, packagePath),
				inlineLoadManifest(updater, buildOpts),
				...(isContainer
					? []
					: [
							...(config.middleware?.external
								? [
										openNextExternalMiddlewarePlugin(
											path.join(buildOpts.openNextDistDir, "core/edgeFunctionHandler.js")
										),
									]
								: []),
							openNextEdgePlugins({
								nextDir: path.join(buildOpts.appBuildOutputPath, ".next"),
								isInCloudflare: true,
							}),
						]),
			],
			additionalCodePatches: isContainer
				? [patchUseCacheIO, patchTurbopackRuntime]
				: [patchResRevalidate, patchUseCacheIO, patchOpenTelemetryGlobalUtils, patchTurbopackRuntime],
		},
		middlewareBundle: {
			useEdgeConfig: true,
			banner: (_name: string) => [
				`globalThis.monorepoPackagePath = "${normalizePath(packagePath)}";`,
				`import { Buffer } from "node:buffer";
globalThis.Buffer = Buffer;

import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage = AsyncLocalStorage;

`,
			],
			additionalPlugins: (updater: ContentUpdater, outputs: NextAdapterOutputs) => [
				inlineRouteHandler(updater, outputs, packagePath),
				inlineLoadManifest(updater, buildOpts),
				openNextEdgePlugins({
					nextDir: path.join(buildOpts.appBuildOutputPath, ".next"),
					isInCloudflare: true,
				}),
			],
			additionalCodePatches: [
				patchResRevalidate,
				patchUseCacheIO,
				patchOpenTelemetryGlobalUtils,
				patchWebpackMiddlewareRuntime,
				patchTurbopackRuntime,
			],
		},
		afterServerBundle: async (buildOpts, _config) => {
			if (isContainer) {
				const packageDistDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
				compileContainer(buildOpts);
				copyPackageCliFiles(packageDistDir, buildOpts, "container");
				return;
			}
			compileDurableObjects(buildOpts);
			await bundleServer(buildOpts, { minify: false } as any);
		},
	};
});
