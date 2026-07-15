import fs from "node:fs";
import path from "node:path";

import type { BuildOptions } from "@opennextjs/core/build/helper.js";

import { getOutputWorkerPath } from "../bundle-server.js";

type WorkerTemplate = "container" | "worker";

/**
 * Copies
 * - the template files present in the cloudflare adapter package to `.open-next/cloudflare-templates`
 * - the selected Worker template as `.open-next/worker.js`
 */
export function copyPackageCliFiles(
	packageDistDir: string,
	buildOpts: BuildOptions,
	workerTemplate: WorkerTemplate = "worker"
) {
	console.log("# copyPackageTemplateFiles");
	const sourceDir = path.join(packageDistDir, "cli/templates");

	const destinationDir = path.join(buildOpts.outputDir, "cloudflare-templates");

	fs.mkdirSync(destinationDir, { recursive: true });
	fs.cpSync(sourceDir, destinationDir, { recursive: true });

	fs.copyFileSync(
		path.join(packageDistDir, `cli/templates/${workerTemplate}.js`),
		getOutputWorkerPath(buildOpts)
	);
}
