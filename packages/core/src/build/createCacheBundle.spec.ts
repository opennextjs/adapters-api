import path from "node:path";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs", () => ({
	default: { mkdirSync: vi.fn() },
}));

vi.mock("../plugins/resolve.js", () => ({
	openNextResolvePlugin: vi.fn(() => ({
		name: "opennext-resolve",
		setup: vi.fn(),
	})),
}));

vi.mock("./helper.js", () => ({
	copyOpenNextConfig: vi.fn(),
	esbuildAsync: vi.fn(),
}));

import { createCacheBundle } from "./createCacheBundle.js";
import * as buildHelper from "./helper.js";

describe("createCacheBundle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("builds wrapped and raw cache handler entrypoints", async () => {
		const options = {
			buildDir: "/app/.open-next/.build",
			config: { default: {} },
			openNextDistDir: "/core/dist",
			outputDir: "/app/.open-next",
		};

		await createCacheBundle(options as never);

		expect(buildHelper.esbuildAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				entryPoints: {
					index: path.join(options.openNextDistDir, "adapters", "cache-adapter.js"),
					handler: path.join(options.openNextDistDir, "adapters", "cache-handler.js"),
				},
				outdir: path.join(options.outputDir, "cache-function"),
				outExtension: { ".js": ".mjs" },
			}),
			options
		);
	});
});
