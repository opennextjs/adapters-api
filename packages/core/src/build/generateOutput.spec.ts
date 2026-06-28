import * as fs from "node:fs";

import { describe, test, expect, vi } from "vitest";

import type { OpenNextConfig } from "../types/open-next.js";

import { buildOpenNextOutput, generateOutput } from "./generateOutput.js";
import type { BuildOptions } from "./helper.js";

// We need to mock fs and the loadConfig import to avoid touching real files.
// The file imports { loadConfig } from "@/config/util.js" and uses fs directly.

vi.mock("node:fs", () => ({
	default: {
		readdirSync: vi.fn(() => []),
		statSync: vi.fn(() => ({ isDirectory: () => false })),
		writeFileSync: vi.fn(),
		existsSync: vi.fn(() => false),
	},
	readdirSync: vi.fn(() => []),
	statSync: vi.fn(() => ({ isDirectory: () => false })),
	writeFileSync: vi.fn(),
	existsSync: vi.fn(() => false),
}));

vi.mock("@/config/util.js", () => ({
	loadConfig: vi.fn(() => ({ basePath: "" })),
}));

function createMockBuildOpts(): BuildOptions {
	return {
		appBuildOutputPath: "/app/build",
		appPackageJsonPath: "/app/package.json",
		appPath: "/app",
		appPublicPath: "/app/public",
		buildDir: "/app/.open-next/.build",
		config: {
			default: {},
			dangerous: {},
		} as unknown as OpenNextConfig,
		debug: false,
		minify: true,
		monorepoRoot: "/app",
		nextVersion: "16.0.0",
		openNextVersion: "0.1.0",
		openNextDistDir: "/fake/opennext/dist",
		outputDir: "/app/.open-next",
		packager: "npm" as const,
		tempBuildDir: "/tmp/open-next-tmp",
	};
}

describe("buildOpenNextOutput", () => {
	test("returns an OpenNextOutput with expected keys (no fs writes)", async () => {
		const opts = createMockBuildOpts();
		const output = await buildOpenNextOutput(opts);
		expect(output).toHaveProperty("edgeFunctions");
		expect(output).toHaveProperty("origins");
		expect(output).toHaveProperty("behaviors");
		expect(output).toHaveProperty("additionalProps");
		// fs.writeFileSync must NOT be called by buildOpenNextOutput
		expect(fs.writeFileSync).not.toHaveBeenCalled();
	});

	test("returns undefined revalidationFunction when disableIncrementalCache is true", async () => {
		const opts = createMockBuildOpts();
		(opts.config as OpenNextConfig).dangerous = { disableIncrementalCache: true };
		const output = await buildOpenNextOutput(opts);
		expect(output.additionalProps?.revalidationFunction).toBeUndefined();
	});
});

describe("generateOutput (legacy wrapper)", () => {
	test("calls buildOpenNextOutput then writes the file", async () => {
		const opts = createMockBuildOpts();
		await generateOutput(opts);
		expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
		const [filePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
		expect(filePath).toMatch(/\/\.open-next\/open-next\.output\.json$/);
		const parsed = JSON.parse(content);
		expect(parsed).toHaveProperty("behaviors");
		expect(parsed).toHaveProperty("origins");
	});
});
