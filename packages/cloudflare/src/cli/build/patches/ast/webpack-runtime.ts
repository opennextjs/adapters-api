/**
 * Inline dynamic requires in the webpack runtime.
 *
 * The webpack runtime has dynamic requires that would not be bundled by ESBuild:
 *
 *     installChunk(require("./chunks/" + __webpack_require__.u(chunkId)));
 *
 *  This patch unrolls the dynamic require for all the existing chunks:
 *
 *  For multiple chunks:
 *     switch (chunkId) {
 *       case ID1: installChunk(require("./chunks/ID1")); break;
 *       case ID2: installChunk(require("./chunks/ID2")); break;
 *       // ...
 *       case SELF_ID: installedChunks[chunkId] = 1; break;
 *       default: throw new Error(`Unknown chunk ${chunkId}`);
 *     }
 *
 * For a single chunk:
 *     require("./chunks/CHUNK_ID.js");
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type BuildOptions, getPackagePath } from "@opennextjs/core/build/helper.js";
import { patchCode } from "@opennextjs/core/build/patch/astCodePatcher.js";
import type { CodePatcher } from "@opennextjs/core/build/patch/codePatcher.js";
import { getCrossPlatformPathRegex } from "@opennextjs/core/utils/regex.js";

// Inline the code when there are multiple chunks
export function buildMultipleChunksRule(chunks: number[]) {
	return `
rule:
  pattern: ($CHUNK_ID, $_PROMISES) => { $$$ }
  inside: {pattern: $_.$_.require = $$$_, stopBy: end}
  all:
    - has: {pattern: $INSTALL(require("./chunks/" + $$$)), stopBy: end}
    - has: {pattern: $SELF_ID != $CHUNK_ID, stopBy: end}
    - has: {pattern: "$INSTALLED_CHUNK[$CHUNK_ID] = 1", stopBy: end}
fix: |
  ($CHUNK_ID, _) => {
    if (!$INSTALLED_CHUNK[$CHUNK_ID]) {
      switch ($CHUNK_ID) {
${chunks.map((chunk) => `         case ${chunk}: $INSTALL(require("./chunks/${chunk}.js")); break;`).join("\n")}
         case $SELF_ID: $INSTALLED_CHUNK[$CHUNK_ID] = 1; break;
         default: throw new Error(\`Unknown chunk \${$CHUNK_ID}\`);
      }
    }
  }`;
}

// Inline the code when there is a single chunk.
// For example when there is a single Pages API route.
// Note: The chunk does not always exist, which explains the need for the try...catch.
export const singleChunkRule = `
rule:
  pattern: ($CHUNK_ID, $_PROMISES) => { $$$ }
  inside: {pattern: $_.$_.require = $$$_, stopBy: end}
  all:
    - has: {pattern: $INSTALL(require("./chunks/" + $$$)), stopBy: end}
    - has: {pattern: $SELF_ID == $CHUNK_ID, stopBy: end}
    - has: {pattern: "$INSTALLED_CHUNK[$CHUNK_ID] = 1", stopBy: end}
fix: |
  ($CHUNK_ID, _) => {
    if (!$INSTALLED_CHUNK[$CHUNK_ID]) {
      try {
        $INSTALL(require("./chunks/$SELF_ID.js"));
      } catch {}
    }
  }
`;

export function patchWebpackRuntimeCode(code: string, chunks: number[]): string {
	let patched = patchCode(code, buildMultipleChunksRule(chunks));
	patched = patchCode(patched, singleChunkRule);
	return patched;
}

function getWebpackChunks(tracedFiles: string[]): number[] {
	const chunks = new Set<number>();
	for (const file of tracedFiles) {
		const match = file.match(/[\\/]chunks[\\/](\d+)\.js$/);
		if (match) {
			chunks.add(Number(match[1]));
		}
	}
	return Array.from(chunks).sort((a, b) => a - b);
}

/**
 * Rewrites webpack runtime chunk loading in an external middleware bundle.
 *
 * The middleware trace already contains every required chunk. Using the traced
 * paths keeps the generated requires visible to the Worker bundler and also
 * supports middleware bundles with no chunks.
 */
export const patchWebpackMiddlewareRuntime: CodePatcher = {
	name: "inline-webpack-chunks",
	patches: [
		{
			pathFilter: getCrossPlatformPathRegex(String.raw`webpack(?:-api)?-runtime\.js$`, {
				escape: false,
			}),
			contentFilter: /require\("\.\/chunks\/"\s*\+/,
			patchCode: async ({ code, tracedFiles }) =>
				patchWebpackRuntimeCode(code, getWebpackChunks(tracedFiles)),
		},
	],
};

/**
 * Fixes the webpack-runtime.js and webpack-api-runtime.js files by inlining
 * the webpack dynamic requires.
 */
export async function patchWebpackRuntime(buildOpts: BuildOptions) {
	const { outputDir } = buildOpts;

	const dotNextServerDir = join(
		outputDir,
		"server-functions/default",
		getPackagePath(buildOpts),
		".next/server"
	);

	// Look for all the chunks.
	const chunksDir = join(dotNextServerDir, "chunks");
	const chunks = existsSync(chunksDir)
		? readdirSync(chunksDir)
				.filter((chunk) => /^\d+\.js$/.test(chunk))
				.map((chunk) => Number(chunk.replace(/\.js$/, "")))
		: [];

	patchFile(join(dotNextServerDir, "webpack-runtime.js"), chunks);
	patchFile(join(dotNextServerDir, "webpack-api-runtime.js"), chunks);
}

/**
 * Inline chunks when the file exists.
 *
 * @param filename Path to the webpack runtime.
 * @param chunks List of chunks in the chunks folder.
 */
function patchFile(filename: string, chunks: number[]) {
	if (existsSync(filename)) {
		let code = readFileSync(filename, "utf-8");
		code = patchWebpackRuntimeCode(code, chunks);
		writeFileSync(filename, code);
	}
}
