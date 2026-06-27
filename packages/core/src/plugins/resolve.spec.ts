import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginBuild } from "esbuild";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { openNextResolvePlugin } from "./resolve.js";

const FIXTURE_CONTENT = [
	'await import("../overrides/converters/node.js")',
	'await import("../overrides/wrappers/node.js")',
	'await import("../overrides/tagCache/fs-dev-nextMode.js")',
	'await import("../overrides/queue/direct.js")',
	'await import("../overrides/incrementalCache/fs-dev.js")',
	'await import("../overrides/imageLoader/fs-dev.js")',
	'await import("../overrides/originResolver/pattern-env.js")',
	'await import("../overrides/assetResolver/dummy.js")',
	'await import("../overrides/warmer/dummy.js")',
	'await import("../overrides/proxyExternalRequest/node.js")',
	'await import("../overrides/cdnInvalidation/dummy.js")',
].join("\n");

type OnLoadCallback = (args: { path: string }) => Promise<{ contents: string }>;

function createStubBuild() {
	let capturedCb: OnLoadCallback | undefined;
	const stub = {
		onLoad: (_opts: { filter: RegExp }, cb: OnLoadCallback) => {
			capturedCb = cb;
		},
	} as unknown as PluginBuild;
	return { stub, getCallback: () => capturedCb! };
}

describe("openNextResolvePlugin", () => {
	let fixturePath: string;
	let fixtureDir: string;

	beforeEach(async () => {
		fixtureDir = join(tmpdir(), `resolve-test-${Date.now()}`, "core");
		await mkdir(fixtureDir, { recursive: true });
		fixturePath = join(fixtureDir, "resolve.js");
		await writeFile(fixturePath, FIXTURE_CONTENT, "utf-8");
	});

	afterEach(async () => {
		// Clean up the temp directory (go up one level from "core")
		await rm(join(fixtureDir, ".."), { recursive: true, force: true });
	});

	async function runPlugin(opts: Parameters<typeof openNextResolvePlugin>[0]) {
		const plugin = openNextResolvePlugin(opts);
		const { stub, getCallback } = createStubBuild();
		plugin.setup(stub);
		const cb = getCallback();
		return cb({ path: fixturePath });
	}

	test("A - platform default applied when no config override", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: { converter: "edge" },
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/edge.js");
		expect(result.contents).not.toContain("../overrides/converters/node.js");
	});

	test("B - config override wins over platform default", async () => {
		const result = await runPlugin({
			overrides: { converter: "aws-apigw-v2" },
			defaultOverrides: { converter: "edge" },
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/aws-apigw-v2.js");
		expect(result.contents).not.toContain("../overrides/converters/edge.js");
	});

	test("C - no rewrite when neither provided", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: {},
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/node.js");
	});

	test("D - all 10 keys covered", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: {
				wrapper: "aws-lambda",
				converter: "edge",
				tagCache: "dynamodb",
				queue: "sqs",
				incrementalCache: "s3",
				imageLoader: "host",
				originResolver: "dummy",
				warmer: "aws-lambda",
				proxyExternalRequest: "fetch",
				cdnInvalidation: "cloudfront",
			},
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/wrappers/aws-lambda.js");
		expect(result.contents).toContain("../overrides/converters/edge.js");
		expect(result.contents).toContain("../overrides/tagCache/dynamodb.js");
		expect(result.contents).toContain("../overrides/queue/sqs.js");
		expect(result.contents).toContain("../overrides/incrementalCache/s3.js");
		expect(result.contents).toContain("../overrides/imageLoader/host.js");
		expect(result.contents).toContain("../overrides/originResolver/dummy.js");
		expect(result.contents).toContain("../overrides/warmer/aws-lambda.js");
		expect(result.contents).toContain("../overrides/proxyExternalRequest/fetch.js");
		expect(result.contents).toContain("../overrides/cdnInvalidation/cloudfront.js");
	});

	test("E - cloudflare to cloudflare-edge deprecation with platform defaults", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: { wrapper: "cloudflare" },
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/wrappers/cloudflare-edge.js");
		expect(result.contents).not.toContain("../overrides/wrappers/cloudflare.js");
	});

	test("F - function config override preserved over platform default", async () => {
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any - testing function override
		const fnOverride = (() => ({})) as any;
		const result = await runPlugin({
			overrides: { converter: fnOverride },
			defaultOverrides: { converter: "edge" },
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/dummy.js");
		expect(result.contents).not.toContain("../overrides/converters/edge.js");
	});
});
