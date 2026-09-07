import fs from "node:fs";

import { copyAdapterFiles } from "@opennextjs/core/build/copyAdapterFiles.js";
import type { BuildOptions } from "@opennextjs/core/build/helper.js";
import type { NextAdapterOutputs } from "@opennextjs/core/types/adapter.js";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@opennextjs/core/debug.js", () => ({
	addDebugFile: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		default: {
			...actual,
			mkdirSync: vi.fn(),
			copyFileSync: vi.fn(),
			readlinkSync: vi.fn(() => ""),
			symlinkSync: vi.fn(),
		},
		mkdirSync: vi.fn(),
		copyFileSync: vi.fn(),
		readlinkSync: vi.fn(() => ""),
		symlinkSync: vi.fn(),
	};
});

function createMockBuildOpts(overrides: Partial<BuildOptions> = {}): BuildOptions {
	return {
		appBuildOutputPath: "/app/build",
		appPackageJsonPath: "/app/package.json",
		appPath: "/app",
		appPublicPath: "/app/public",
		buildDir: "/app/.open-next/.build",
		config: { default: {}, dangerous: {} } as unknown as BuildOptions["config"],
		debug: false,
		minify: true,
		monorepoRoot: "/app",
		nextVersion: "16.0.0",
		openNextVersion: "0.1.0",
		openNextDistDir: "/fake/opennext/dist",
		outputDir: "/app/.open-next",
		packager: "npm" as const,
		tempBuildDir: "/tmp/open-next-tmp",
		...overrides,
	} as BuildOptions;
}

function createMockOutputs(): NextAdapterOutputs {
	return {
		middleware: {
			pathname: "/",
			filePath: "/app/middleware.js",
			assets: { "asset.txt": "/app/asset.txt" },
		},
		pages: [{ pathname: "/", filePath: "/app/page.js", assets: {} }],
		appPages: [{ pathname: "/foo", filePath: "/app/foo.js", assets: {} }],
		pagesApi: [],
		appRoutes: [],
	};
}

function getCopyFileSyncDestinations(): string[] {
	const calls = vi.mocked(fs.copyFileSync).mock.calls;
	return calls.map(([, to]) => to as string);
}

describe("copyAdapterFiles", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fs.readlinkSync).mockReturnValue("");
	});

	test("iterates all keys and copies middleware + pages + appPages when destDir is omitted", async () => {
		const options = createMockBuildOpts();
		const outputs = createMockOutputs();

		await copyAdapterFiles(options, "fn-name", "", outputs);

		const dests = getCopyFileSyncDestinations();
		expect(dests).toEqual(
			expect.arrayContaining([
				expect.stringContaining("/middleware.js"),
				expect.stringContaining("/asset.txt"),
				expect.stringContaining("/page.js"),
				expect.stringContaining("/foo.js"),
			])
		);
		expect(dests).toHaveLength(4);
	});

	test("destDir overrides the default server-functions/fn-name destination", async () => {
		const options = createMockBuildOpts();
		const outputs = createMockOutputs();

		await copyAdapterFiles(options, "fn-name", "", outputs, "/custom/dest");

		const dests = getCopyFileSyncDestinations();
		expect(dests).toHaveLength(4);
		for (const dest of dests) {
			expect(dest.startsWith("/custom/dest/")).toBe(true);
			expect(dest.includes("server-functions")).toBe(false);
			expect(dest.includes("fn-name")).toBe(false);
		}
	});

	test("copies only middleware (and its asset) when caller passes a stripped outputs with empty page arrays", async () => {
		const options = createMockBuildOpts();
		const middlewareOnly: NextAdapterOutputs = {
			middleware: {
				pathname: "/",
				filePath: "/app/middleware.js",
				assets: { "asset.txt": "/app/asset.txt" },
			},
			pages: [],
			pagesApi: [],
			appPages: [],
			appRoutes: [],
		};

		await copyAdapterFiles(options, "fn-name", "", middlewareOnly, "/app/.open-next/middleware");

		const dests = getCopyFileSyncDestinations();
		expect(dests).toHaveLength(2);
		expect(dests).toEqual(
			expect.arrayContaining([
				expect.stringContaining("/middleware.js"),
				expect.stringContaining("/asset.txt"),
			])
		);
		for (const dest of dests) {
			expect(dest.includes("page.js")).toBe(false);
			expect(dest.includes("foo.js")).toBe(false);
		}
	});
});
