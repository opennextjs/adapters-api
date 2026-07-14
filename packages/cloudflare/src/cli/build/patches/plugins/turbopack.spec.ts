import { describe, expect, test } from "vitest";

import { patchTurbopackRuntime } from "./turbopack.js";

describe("turbopack runtime", () => {
	const runtimeCode = `
function loadRuntimeChunkPath(chunkPath) {
  const resolved = chunkPath;
  return require(resolved);
}
`;

	test("uses the middleware traced chunks", async () => {
		const patch = patchTurbopackRuntime.patches[0]!;
		const result = await patch.patchCode({
			code: runtimeCode,
			tracedFiles: ["/app/.open-next/middleware/app/.next/server/chunks/ssr/chunk.js"],
		} as never);

		expect(result).toContain('case "server/chunks/ssr/chunk.js"');
		expect(result).toContain(
			'return require("/app/.open-next/middleware/app/.next/server/chunks/ssr/chunk.js")'
		);
	});

	test("supports middleware with no chunks", async () => {
		const patch = patchTurbopackRuntime.patches[0]!;
		const result = await patch.patchCode({ code: runtimeCode, tracedFiles: [] } as never);

		expect(result).toContain("function requireChunk(chunkPath)");
		expect(result).toContain("default:");
	});
});
