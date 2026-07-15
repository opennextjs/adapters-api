import { createRequire } from "node:module";
import path from "node:path";

import { type BuildOptions, esbuildSync } from "@opennextjs/core/build/helper.js";

/** Compiles the Container Durable Object used by the generated Worker entrypoint. */
export function compileContainer(buildOpts: BuildOptions) {
	const require = createRequire(import.meta.url);
	const entryPoint = require.resolve("@opennextjs/cloudflare/container");

	return esbuildSync(
		{
			entryPoints: [entryPoint],
			bundle: true,
			platform: "node",
			format: "esm",
			outfile: path.join(buildOpts.buildDir, "open-next-container.js"),
			external: ["cloudflare:workers"],
		},
		buildOpts
	);
}
