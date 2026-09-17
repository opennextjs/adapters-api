import { patchCode } from "@opennextjs/core/build/patch/astCodePatcher.js";
import type { CodePatcher } from "@opennextjs/core/build/patch/codePatcher.js";
import { normalizePath } from "@opennextjs/core/utils/normalize-path.js";
import { getCrossPlatformPathRegex } from "@opennextjs/core/utils/regex.js";

const inlineChunksRule = `
rule:
  kind: call_expression
  pattern: require(resolved)
fix:
  requireChunk(chunkPath)
`;

export const patchTurbopackRuntime: CodePatcher = {
	name: "inline-turbopack-chunks",
	patches: [
		{
			versions: ">=15.0.0",
			pathFilter: getCrossPlatformPathRegex(String.raw`\[turbopack\]_runtime\.js$`, {
				escape: false,
			}),
			contentFilter: /loadRuntimeChunkPath/,
			patchCode: async ({ code, tracedFiles }) => {
				let patched = patchCode(code, inlineExternalImportRule);
				patched = patchCode(patched, inlineChunksRule);

				return `${patched}\n${inlineChunksFn(tracedFiles)}`;
			},
		},
	],
};

/**
 * Returns traced Turbopack chunks using paths that are valid in generated JavaScript.
 *
 * @param tracedFiles Files copied from the Next.js middleware trace.
 * @returns Normalized chunk paths, excluding the runtime itself.
 */
function getInlinableChunks(tracedFiles: string[]): string[] {
	const chunks = new Set<string>();
	for (const file of tracedFiles) {
		const normalizedFile = normalizePath(file);
		if (normalizedFile.endsWith("/[turbopack]_runtime.js") || normalizedFile === "[turbopack]_runtime.js") {
			continue;
		}
		if (normalizedFile.includes(".next/server/chunks/")) {
			chunks.add(normalizedFile);
		}
	}
	return Array.from(chunks);
}

/**
 * Generates a static Turbopack chunk loader for a middleware trace.
 *
 * @param tracedFiles Files copied from the Next.js middleware trace.
 * @returns JavaScript source for the static chunk loader.
 */
function inlineChunksFn(tracedFiles: string[]): string {
	// From the outputs, we extract every chunks
	const chunks = getInlinableChunks(tracedFiles);
	return `
  function requireChunk(chunkPath) {
    switch(chunkPath) {
${chunks
	.map((chunk) => {
		// We only want the path after /path/to/.next/ for the runtime lookup.
		const chunkPath = chunk.replace(/.*\/\.next\//, "");
		return `      case ${JSON.stringify(chunkPath)}: return require(${JSON.stringify(chunk)});`;
	})
	.join("\n")}
      default:
        throw new Error(\`Not found \${chunkPath}\`);
    }
  }
`;
}

// Turbopack imports `og` via `externalImport`.
// We patch it to:
// - add the explicit path so that the file is inlined by wrangler
// - use the edge version of the module instead of the node version.
//
// Modules that are not inlined (no added to the switch), would generate an error similar to:
// Failed to load external module path/to/module: Error: No such module "path/to/module"
const inlineExternalImportRule = `
rule:
  pattern: "$RAW = await import($ID)"
  inside:
    regex: "externalImport"
    kind: function_declaration
    stopBy: end
fix: |-
  switch ($ID) {
    case "next/dist/compiled/@vercel/og/index.node.js":
      $RAW = await import("next/dist/compiled/@vercel/og/index.edge.js");
      break;
    default:
      $RAW = await import($ID);
  }
`;
