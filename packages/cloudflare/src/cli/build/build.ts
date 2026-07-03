import { buildNextjsApp, setStandaloneBuildMode } from "@opennextjs/core/build/buildNextApp.js";
import * as buildHelper from "@opennextjs/core/build/helper.js";
import { printHeader } from "@opennextjs/core/build/utils.js";
import logger from "@opennextjs/core/logger.js";

import type { ProjectOptions } from "../project-options.js";
import { ensureNextjsVersionSupported } from "../utils/nextjs-support.js";

import { getVersion } from "./utils/version.js";

/**
 * Builds the application in a format that can be passed to workerd
 *
 * It saves the output in a `.worker-next` directory
 *
 * @param options The OpenNext options
 * @param config The OpenNext config
 * @param projectOpts The options for the project
 */
export async function build(options: buildHelper.BuildOptions, projectOpts: ProjectOptions): Promise<void> {
	// Do not minify the code so that we can apply string replacement patch.
	options.minify = false;

	// Pre-build validation
	buildHelper.checkRunningInsideNextjsApp(options);
	logger.info(`App directory: ${options.appPath}`);
	buildHelper.printNextjsVersion(options);
	await ensureNextjsVersionSupported(options);
	const { aws, cloudflare } = getVersion();
	logger.info(`@opennextjs/cloudflare version: ${cloudflare}`);
	logger.info(`@opennextjs/core version: ${aws}`);

	// Clean the output directory before building the Next app.
	buildHelper.initOutputDir(options);

	if (projectOpts.skipNextBuild) {
		logger.warn("Skipping Next.js build");
	} else {
		// Build the next app
		printHeader("Building Next.js app");
		setStandaloneBuildMode(options);
		buildNextjsApp(options);
	}

	logger.info("Using adapter outputs for building OpenNext bundle.");
}
