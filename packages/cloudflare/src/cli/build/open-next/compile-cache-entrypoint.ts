import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BuildOptions } from "@opennextjs/core/build/helper.js";
import { build } from "esbuild";

/**
 * Compiles the `OpenNextCache` named entrypoint.
 *
 * `./init.js` and `../cache-function/index.mjs` are kept external: they are emitted next to the
 * entrypoint in the output directory and resolved when wrangler bundles the worker. Inlining
 * `./init.js` would duplicate the `AsyncLocalStorage` holding the Cloudflare context.
 */
export async function compileCacheEntrypoint(options: BuildOptions) {
	const currentDir = path.join(path.dirname(fileURLToPath(import.meta.url)));
	const templatesDir = path.join(currentDir, "../../templates");
	const entrypointPath = path.join(templatesDir, "cache-entrypoint.js");

	await build({
		entryPoints: [entrypointPath],
		outdir: path.join(options.outputDir, "cloudflare"),
		bundle: true,
		minify: false,
		format: "esm",
		target: "esnext",
		platform: "node",
		external: ["cloudflare:workers", "./init.js", "../cache-function/index.mjs"],
	});
}
