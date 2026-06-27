import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginBuild } from "esbuild";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { openNextResolvePlugin } from "./resolve.js";

// Synthetic resolve.js module body mirroring compiled output with relative-path imports.
// Each function has exactly ONE await import with a relative ../overrides/ path.
const FIXTURE_CONTENT = `
export async function resolveConverter(converter) {
  if (typeof converter === "function") return converter();
  const m_1 = await import("../overrides/converters/node.js");
  return m_1.default;
}
export async function resolveWrapper(wrapper) {
  if (typeof wrapper === "function") return wrapper();
  const m_1 = await import("../overrides/wrappers/node.js");
  return m_1.default;
}
export async function resolveTagCache(tagCache) {
  if (typeof tagCache === "function") return tagCache();
  const m_1 = await import("../overrides/tagCache/fs-dev-nextMode.js");
  return m_1.default;
}
export async function resolveQueue(queue) {
  if (typeof queue === "function") return queue();
  const m_1 = await import("../overrides/queue/direct.js");
  return m_1.default;
}
export async function resolveIncrementalCache(incrementalCache) {
  if (typeof incrementalCache === "function") return incrementalCache();
  const m_1 = await import("../overrides/incrementalCache/fs-dev.js");
  return m_1.default;
}
export async function resolveImageLoader(imageLoader) {
  if (typeof imageLoader === "function") return imageLoader();
  const m_1 = await import("../overrides/imageLoader/fs-dev.js");
  return m_1.default;
}
export async function resolveOriginResolver(originResolver) {
  if (typeof originResolver === "function") return originResolver();
  const m_1 = await import("../overrides/originResolver/pattern-env.js");
  return m_1.default;
}
export async function resolveWarmerInvoke(warmer) {
  if (typeof warmer === "function") return warmer();
  const m_1 = await import("../overrides/warmer/dummy.js");
  return m_1.default;
}
export async function resolveProxyRequest(proxyRequest) {
  if (typeof proxyRequest === "function") return proxyRequest();
  const m_1 = await import("../overrides/proxyExternalRequest/node.js");
  return m_1.default;
}
export async function resolveCdnInvalidation(cdnInvalidation) {
  if (typeof cdnInvalidation === "function") return cdnInvalidation();
  const m_1 = await import("../overrides/cdnInvalidation/dummy.js");
  return m_1.default;
}
`.trim();

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

	test("A - full-path default verbatim: core full path default replaces anchor", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(result.contents).toContain("@opennextjs/core/overrides/converters/edge.js");
		expect(result.contents).not.toContain("@opennextjs/core/overrides/converters/node.js");
	});

	test("B - cross-package user full aws path wins over core default", async () => {
		const result = await runPlugin({
			overrides: { converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js" },
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(result.contents).toContain("@opennextjs/aws/overrides/converters/aws-apigw-v2.js");
		expect(result.contents).not.toContain("@opennextjs/core/overrides/converters/edge.js");
	});

	test("C - no-op anchor stays: no override no default keeps relative core path", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: {},
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/node.js");
	});

	test("D - 10-key mixed aws+core full paths all rewritten", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
				converter: "@opennextjs/core/overrides/converters/edge.js",
				tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
				queue: "@opennextjs/aws/overrides/queue/sqs.js",
				incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
				imageLoader: "@opennextjs/core/overrides/imageLoader/dummy.js",
				originResolver: "@opennextjs/core/overrides/originResolver/dummy.js",
				warmer: "@opennextjs/aws/overrides/warmer/aws-lambda.js",
				proxyExternalRequest: "@opennextjs/core/overrides/proxyExternalRequest/fetch.js",
				cdnInvalidation: "@opennextjs/aws/overrides/cdnInvalidation/cloudfront.js",
			},
			fnName: "test",
		});
		expect(result.contents).toContain("@opennextjs/aws/overrides/wrappers/aws-lambda.js");
		expect(result.contents).toContain("@opennextjs/core/overrides/converters/edge.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/tagCache/dynamodb.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/queue/sqs.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/incrementalCache/s3.js");
		expect(result.contents).toContain("@opennextjs/core/overrides/imageLoader/dummy.js");
		expect(result.contents).toContain("@opennextjs/core/overrides/originResolver/dummy.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/warmer/aws-lambda.js");
		expect(result.contents).toContain("@opennextjs/core/overrides/proxyExternalRequest/fetch.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/cdnInvalidation/cloudfront.js");
	});

	test("E - deprecated cloudflare bare name becomes legacy relative core path", async () => {
		const result = await runPlugin({
			overrides: { wrapper: "cloudflare" },
			defaultOverrides: {},
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/wrappers/cloudflare-edge.js");
		expect(result.contents).not.toContain("cloudflare.js");
	});

	test("F - function override becomes full dummy core path", async () => {
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any - testing function override
		const fnOverride = (() => ({})) as any;
		const result = await runPlugin({
			overrides: { converter: fnOverride },
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(result.contents).toContain("@opennextjs/core/overrides/converters/dummy.js");
		expect(result.contents).not.toContain("@opennextjs/core/overrides/converters/edge.js");
	});

	test("G - AWS server defaults produce aws full paths", async () => {
		const result = await runPlugin({
			overrides: {},
			defaultOverrides: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
				incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
				tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
				queue: "@opennextjs/aws/overrides/queue/sqs.js",
			},
			fnName: "server",
		});
		expect(result.contents).toContain("@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/converters/aws-apigw-v2.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/incrementalCache/s3.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/tagCache/dynamodb.js");
		expect(result.contents).toContain("@opennextjs/aws/overrides/queue/sqs.js");
	});

	test("H - bare-name user override becomes legacy relative core path", async () => {
		const result = await runPlugin({
			overrides: { converter: "edge" },
			defaultOverrides: {},
			fnName: "test",
		});
		expect(result.contents).toContain("../overrides/converters/edge.js");
		expect(result.contents).not.toContain("@opennextjs/core/overrides/converters/node.js");
	});
});
