/* oxlint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";

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
import { compileDurableObjects } from "./build/open-next/compileDurableObjects.js";
import { inlineLoadManifest } from "./build/patches/plugins/load-manifest.js";
import { patchResRevalidate } from "./build/patches/plugins/res-revalidate.js";
import { patchTurbopackRuntime } from "./build/patches/plugins/turbopack.js";
import { patchUseCacheIO } from "./build/patches/plugins/use-cache.js";

export default buildAdapter((config: OpenNextConfig, buildOpts: BuildOptions) => {
	const packagePath = buildHelper.getPackagePath(buildOpts);
	return {
		skipRevalidation: true,
		skipImageOptimization: true,
		skipWarmer: true,
		skipGenerateOutput: true,
		middlewareOptions: { forceOnlyBuildOnce: true },
		beforeMiddleware: async (buildOpts, _config) => {
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
			useEdgeConfig: true,
			externals: ["./middleware.mjs"],
			banner: (name: string) => [
				`globalThis.monorepoPackagePath = "${normalizePath(packagePath)}";`,
				name === "default" ? "" : `globalThis.fnName = "${name}";`,
			],
			additionalPlugins: (updater: ContentUpdater, outputs: NextAdapterOutputs) => [
				inlineRouteHandler(updater, outputs, packagePath),
				inlineLoadManifest(updater, buildOpts),
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
			],
			additionalCodePatches: [patchResRevalidate, patchUseCacheIO, patchTurbopackRuntime],
		},
		afterServerBundle: async (buildOpts, _config) => {
			compileDurableObjects(buildOpts);
			await bundleServer(buildOpts, { minify: false } as any);
		},
	};
});
