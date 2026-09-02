import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

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

// The default overrides imported by the fixture above, and the alternatives the
// tests redirect to.
const OVERRIDE_MODULES = [
	"overrides/converters/node.js",
	"overrides/converters/edge.js",
	"overrides/wrappers/node.js",
	"overrides/wrappers/cloudflare-edge.js",
	"overrides/tagCache/fs-dev-nextMode.js",
	"overrides/queue/direct.js",
	"overrides/incrementalCache/fs-dev.js",
	"overrides/imageLoader/fs-dev.js",
	"overrides/originResolver/pattern-env.js",
	"overrides/warmer/dummy.js",
	"overrides/proxyExternalRequest/node.js",
	"overrides/cdnInvalidation/dummy.js",
];

// Packages resolved through node_modules for the full-path override cases.
const CORE_PKG_MODULES = [
	"overrides/converters/edge.js",
	"overrides/converters/dummy.js",
	"overrides/wrappers/cloudflare-node.js",
	"overrides/imageLoader/dummy.js",
	"overrides/originResolver/dummy.js",
	"overrides/proxyExternalRequest/fetch.js",
];
const AWS_PKG_MODULES = [
	"overrides/wrappers/aws-lambda.js",
	"overrides/wrappers/aws-lambda-streaming.js",
	"overrides/converters/aws-apigw-v2.js",
	"overrides/converters/aws-streaming.js",
	"overrides/tagCache/dynamodb.js",
	"overrides/queue/sqs.js",
	"overrides/incrementalCache/s3.js",
	"overrides/warmer/aws-lambda.js",
	"overrides/cdnInvalidation/cloudfront.js",
];

let root: string;

/** Writes a module exporting a marker identifying it by its path in the fixture. */
async function writeModule(relPath: string) {
	const fullPath = join(root, relPath);
	await mkdir(dirname(fullPath), { recursive: true });
	await writeFile(fullPath, `export default "MARKER:${relPath}";`, "utf-8");
}

/** Marker bundled for an override living next to the fixture `resolve.js`. */
function local(relPath: string) {
	return `MARKER:overrides/${relPath}`;
}

/** Marker bundled for an override coming from a package in `node_modules`. */
function pkg(name: string, relPath: string) {
	return `MARKER:node_modules/${name}/overrides/${relPath}`;
}

/** Bundles the fixture with the plugin and returns the generated code. */
async function bundleWithPlugin(opts: Parameters<typeof openNextResolvePlugin>[0], entry = "entry.js") {
	const result = await build({
		entryPoints: [join(root, entry)],
		absWorkingDir: root,
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		outfile: join(root, "out.js"),
		plugins: [openNextResolvePlugin(opts)],
	});
	return result.outputFiles[0].text;
}

describe("openNextResolvePlugin", () => {
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "resolve-test-"));

		await mkdir(join(root, "core"), { recursive: true });
		await writeFile(join(root, "core", "resolve.js"), FIXTURE_CONTENT, "utf-8");
		await writeFile(join(root, "entry.js"), `export * from "./core/resolve.js";`, "utf-8");

		for (const mod of OVERRIDE_MODULES) {
			await writeModule(mod);
		}
		for (const [name, modules] of [
			["@opennextjs/core", CORE_PKG_MODULES],
			["@opennextjs/aws", AWS_PKG_MODULES],
		] as const) {
			await mkdir(join(root, "node_modules", name), { recursive: true });
			await writeFile(
				join(root, "node_modules", name, "package.json"),
				JSON.stringify({ name, type: "module" }),
				"utf-8"
			);
			for (const mod of modules) {
				await writeModule(join("node_modules", name, mod));
			}
		}
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("A - full-path default verbatim: core full path default replaces anchor", async () => {
		const contents = await bundleWithPlugin({
			overrides: {},
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(contents).toContain(pkg("@opennextjs/core", "converters/edge.js"));
		expect(contents).not.toContain(local("converters/node.js"));
	});

	test("B - cross-package user full aws path wins over core default", async () => {
		const contents = await bundleWithPlugin({
			overrides: { converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js" },
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(contents).toContain(pkg("@opennextjs/aws", "converters/aws-apigw-v2.js"));
		expect(contents).not.toContain(pkg("@opennextjs/core", "converters/edge.js"));
	});

	test("C - no-op anchor stays: no override no default keeps relative core path", async () => {
		const contents = await bundleWithPlugin({
			overrides: {},
			defaultOverrides: {},
			fnName: "test",
		});
		expect(contents).toContain(local("converters/node.js"));
	});

	test("D - 10-key mixed aws+core full paths all rewritten", async () => {
		const contents = await bundleWithPlugin({
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
		expect(contents).toContain(pkg("@opennextjs/aws", "wrappers/aws-lambda.js"));
		expect(contents).toContain(pkg("@opennextjs/core", "converters/edge.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "tagCache/dynamodb.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "queue/sqs.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "incrementalCache/s3.js"));
		expect(contents).toContain(pkg("@opennextjs/core", "imageLoader/dummy.js"));
		expect(contents).toContain(pkg("@opennextjs/core", "originResolver/dummy.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "warmer/aws-lambda.js"));
		expect(contents).toContain(pkg("@opennextjs/core", "proxyExternalRequest/fetch.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "cdnInvalidation/cloudfront.js"));
		// None of the defaults are bundled anymore
		expect(contents).not.toContain(local("wrappers/node.js"));
		expect(contents).not.toContain(local("tagCache/fs-dev-nextMode.js"));
		expect(contents).not.toContain(local("incrementalCache/fs-dev.js"));
	});

	test("E - deprecated cloudflare bare name becomes legacy relative core path", async () => {
		const contents = await bundleWithPlugin({
			overrides: { wrapper: "cloudflare" },
			defaultOverrides: {},
			fnName: "test",
		});
		expect(contents).toContain(local("wrappers/cloudflare-edge.js"));
		expect(contents).not.toContain(local("wrappers/node.js"));
	});

	test("F - function override becomes full dummy core path", async () => {
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any - testing function override
		const fnOverride = (() => ({})) as any;
		const contents = await bundleWithPlugin({
			overrides: { converter: fnOverride },
			defaultOverrides: { converter: "@opennextjs/core/overrides/converters/edge.js" },
			fnName: "test",
		});
		expect(contents).toContain(pkg("@opennextjs/core", "converters/dummy.js"));
		expect(contents).not.toContain(pkg("@opennextjs/core", "converters/edge.js"));
	});

	test("G - AWS server defaults produce aws full paths", async () => {
		const contents = await bundleWithPlugin({
			overrides: {},
			defaultOverrides: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
				incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
				tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
				queue: "@opennextjs/aws/overrides/queue/sqs.js",
			},
			fnName: "server",
		});
		expect(contents).toContain(pkg("@opennextjs/aws", "wrappers/aws-lambda-streaming.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "converters/aws-streaming.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "incrementalCache/s3.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "tagCache/dynamodb.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "queue/sqs.js"));
		// Keys without an override keep their default
		expect(contents).toContain(local("imageLoader/fs-dev.js"));
	});

	test("G2 - a partial AWS wrapper override selects its compatible converter", async () => {
		const contents = await bundleWithPlugin({
			overrides: { wrapper: "aws-lambda" },
			defaultOverrides: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
			},
			fnName: "server",
		});
		expect(contents).toContain(pkg("@opennextjs/aws", "wrappers/aws-lambda.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "converters/aws-apigw-v2.js"));
	});

	test("G3 - a partial AWS converter override selects its compatible wrapper", async () => {
		const contents = await bundleWithPlugin({
			overrides: { converter: "aws-apigw-v2" },
			defaultOverrides: {
				wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
				converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
			},
			fnName: "server",
		});
		expect(contents).toContain(pkg("@opennextjs/aws", "wrappers/aws-lambda.js"));
		expect(contents).toContain(pkg("@opennextjs/aws", "converters/aws-apigw-v2.js"));
	});

	test("H - bare-name user override becomes legacy relative core path", async () => {
		const contents = await bundleWithPlugin({
			overrides: { converter: "edge" },
			defaultOverrides: {},
			fnName: "test",
		});
		expect(contents).toContain(local("converters/edge.js"));
		expect(contents).not.toContain(local("converters/node.js"));
	});

	test("H2 - an ambiguous converter preserves a compatible adapter wrapper", async () => {
		const contents = await bundleWithPlugin({
			overrides: { converter: "edge" },
			defaultOverrides: {
				wrapper: "@opennextjs/core/overrides/wrappers/cloudflare-node.js",
				converter: "@opennextjs/core/overrides/converters/edge.js",
			},
			fnName: "middleware",
		});
		expect(contents).toContain(pkg("@opennextjs/core", "wrappers/cloudflare-node.js"));
		expect(contents).not.toContain(local("wrappers/cloudflare-edge.js"));
	});

	test("I - resolvable package specifier is resolved through node_modules", async () => {
		await mkdir(join(root, "node_modules", "@test-pkg", "wrapper"), { recursive: true });
		await writeFile(
			join(root, "node_modules", "@test-pkg", "wrapper", "package.json"),
			JSON.stringify({ name: "@test-pkg/wrapper", main: "index.js" }),
			"utf-8"
		);
		await writeModule(join("node_modules", "@test-pkg", "wrapper", "index.js"));

		const contents = await bundleWithPlugin({
			overrides: { wrapper: "@test-pkg/wrapper" },
			defaultOverrides: {},
			fnName: "test",
		});

		expect(contents).toContain("MARKER:node_modules/@test-pkg/wrapper/index.js");
		expect(contents).not.toContain(local("wrappers/node.js"));
	});

	test("J - overrides of other modules are left alone", async () => {
		await writeFile(
			join(root, "core", "other.js"),
			`export const load = () => import("../overrides/converters/node.js");`,
			"utf-8"
		);
		await writeFile(
			join(root, "entry-other.js"),
			`export * from "./core/resolve.js";\nexport * from "./core/other.js";`,
			"utf-8"
		);

		const contents = await bundleWithPlugin(
			{
				overrides: { converter: "edge" },
				defaultOverrides: {},
				fnName: "test",
			},
			"entry-other.js"
		);

		// `resolve.js` gets the override, `other.js` keeps importing the default
		expect(contents).toContain(local("converters/edge.js"));
		expect(contents).toContain(local("converters/node.js"));
	});
});
