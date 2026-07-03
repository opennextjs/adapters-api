import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

import { buildNextjsApp, setStandaloneBuildMode } from "@opennextjs/core/build/buildNextApp.js";
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
import { patchOriginalNextConfig } from "@opennextjs/core/build/patch/patches/index.js";
import { printHeader, showWarningOnWindows } from "@opennextjs/core/build/utils.js";
import logger from "@opennextjs/core/logger.js";

const require = createRequire(import.meta.url);

export type PublicFiles = {
	files: string[];
};

export async function build(openNextConfigPath?: string, nodeExternals?: string) {
	showWarningOnWindows();

	const baseDir = process.cwd();
	const openNextDistDir = url.fileURLToPath(new URL(".", import.meta.url));

	const { config, buildDir } = await compileOpenNextConfig(
		path.join(baseDir, openNextConfigPath ?? "open-next.config.ts"),
		{ nodeExternals }
	);

	// Initialize options
	const options = buildHelper.normalizeOptions(config, openNextDistDir, buildDir);
	logger.setLevel(options.debug ? "debug" : "info");

	// Pre-build validation
	buildHelper.checkRunningInsideNextjsApp(options);
	buildHelper.printNextjsVersion(options);
	buildHelper.printOpenNextVersion(options);

	// Build Next.js app
	printHeader("Building Next.js app");
	setStandaloneBuildMode(options);
	logger.info("Using adapter outputs for building OpenNext bundle.");
	process.env.NEXT_ADAPTER_PATH = require.resolve("./adapter.js");
	buildHelper.initOutputDir(options);
	buildNextjsApp(options);

	return;
}
