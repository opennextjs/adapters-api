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
		readFileSync: vi.fn(() => "build-id"),
		writeFileSync: vi.fn(),
		existsSync: vi.fn(() => false),
	},
	readdirSync: vi.fn(() => []),
	statSync: vi.fn(() => ({ isDirectory: () => false })),
	readFileSync: vi.fn(() => "build-id"),
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

	test("uses adapter defaults for generated server metadata", async () => {
		const output = await buildOpenNextOutput(createMockBuildOpts(), {
			server: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
				incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
				tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
				queue: "@opennextjs/aws/overrides/queue/sqs.js",
			},
		});

		expect(output.origins.default).toMatchObject({
			streaming: true,
			wrapper: "aws-lambda-streaming",
			converter: "aws-streaming",
			incrementalCache: "s3",
			tagCache: "dynamodb",
			queue: "sqs",
		});
	});

	test("detects a full-path streaming wrapper", async () => {
		const opts = createMockBuildOpts();
		opts.config.default.override = {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
		};

		const output = await buildOpenNextOutput(opts);
		expect(output.origins.default).toMatchObject({
			streaming: true,
			wrapper: "aws-lambda-streaming",
			converter: "aws-streaming",
		});
	});

	test("awaits lazy overrides when generating global edge metadata", async () => {
		const opts = createMockBuildOpts();
		opts.config.functions = {
			global: {
				routes: ["app/page"],
				runtime: "edge",
				placement: "global",
				override: {
					wrapper: async () => {
						await Promise.resolve();
						return { name: "delayed-wrapper" };
					},
				},
			},
		};

		const output = await buildOpenNextOutput(opts, {
			global: { converter: "@opennextjs/aws/overrides/converters/aws-cloudfront.js" },
		});
		expect(output.edgeFunctions.global).toMatchObject({
			wrapper: "delayed-wrapper",
			converter: "aws-cloudfront",
		});
	});

	test("uses edge defaults for regional edge function metadata", async () => {
		const opts = createMockBuildOpts();
		opts.config.functions = {
			edge: { routes: ["app/page"], runtime: "edge" },
		};

		const output = await buildOpenNextOutput(opts, {
			edge: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
				converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			},
			server: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
			},
		});

		expect(output.origins.edge).toMatchObject({
			wrapper: "aws-lambda",
			converter: "aws-apigw-v2",
			streaming: false,
		});
	});

	test.each([
		["edge", "aws-lambda", "aws-apigw-v2"],
		["node", "aws-lambda-streaming", "aws-streaming"],
	] as const)("falls back to %s defaults for global metadata", async (runtime, wrapper, converter) => {
		const opts = createMockBuildOpts();
		opts.config.functions = {
			global: { routes: ["app/page"], runtime, placement: "global" },
		};

		const output = await buildOpenNextOutput(opts, {
			edge: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
				converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			},
			server: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
			},
		});

		expect(output.edgeFunctions.global).toMatchObject({ wrapper, converter });
	});

	test("uses Node defaults and adapter origin resolver for external middleware metadata", async () => {
		const opts = createMockBuildOpts();
		opts.config.middleware = { external: true, runtime: "node" };

		const output = await buildOpenNextOutput(opts, {
			middleware: { originResolver: "custom-resolver" },
		});

		expect(output.edgeFunctions.middleware).toMatchObject({
			wrapper: "node",
			converter: "node",
			pathResolver: "custom-resolver",
		});
	});

	test("uses edge defaults for generic external edge middleware metadata", async () => {
		const opts = createMockBuildOpts();
		opts.config.middleware = { external: true };

		const output = await buildOpenNextOutput(opts);

		expect(output.edgeFunctions.middleware).toMatchObject({
			wrapper: "dummy",
			converter: "edge",
			pathResolver: "pattern-env",
		});
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
