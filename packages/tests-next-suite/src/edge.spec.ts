import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { disabledEdgeTests, findEdgeRuntimeTests } from "./edge.js";

let nextDir: string;

function write(file: string, content = ""): void {
	const target = path.join(nextDir, file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content);
}

beforeEach(() => {
	nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-edge-"));
});

describe("findEdgeRuntimeTests", () => {
	test.each([
		["an app page", "app/page.tsx", `export const runtime = 'edge'`],
		["double quotes", "app/page.tsx", `export const runtime = "edge";`],
		["the experimental name", "pages/api/a.ts", `export const config = { runtime: 'experimental-edge' }`],
		["a pages config", "pages/a.tsx", `export const config = {\n  runtime: "edge",\n}`],
		["a next.config", "next.config.js", `module.exports = { experimental: { runtime: 'edge' } }`],
	])("finds %s", (_name, file, content) => {
		write("test/e2e/a/a.test.ts");
		write(`test/e2e/a/${file}`, content);

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/a/a.test.ts"]);
	});

	test("finds an app declared inside the test file", () => {
		write("test/e2e/a/a.test.ts", "files: { 'app/page.js': `export const runtime = 'edge'` }");

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/a/a.test.ts"]);
	});

	test("looks at the fixture when tests are in a test directory", () => {
		write("test/e2e/a/test/index.test.ts");
		write("test/e2e/a/app/page.tsx", `export const runtime = 'edge'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/a/test/index.test.ts"]);
	});

	test("ignores the Node.js runtime", () => {
		write("test/e2e/a/a.test.ts");
		write("test/e2e/a/app/page.tsx", `export const runtime = 'nodejs'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual([]);
	});

	test("ignores middleware, which is not an edge page", () => {
		write("test/e2e/a/a.test.ts");
		write("test/e2e/a/middleware.ts", `export const config = { runtime: 'experimental-edge' }`);
		write("test/e2e/a/proxy.ts", `export const config = { runtime: 'edge' }`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual([]);
	});

	test("ignores dependencies and build output", () => {
		write("test/e2e/a/a.test.ts");
		write("test/e2e/a/node_modules/x/index.js", `export const runtime = 'edge'`);
		write("test/e2e/a/.next/server/page.js", `export const runtime = 'edge'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual([]);
	});

	test("does not scan all tests for a test at the root of the e2e directory", () => {
		write("test/e2e/prerender.test.ts");
		write("test/e2e/other/other.test.ts");
		write("test/e2e/other/app/page.tsx", `export const runtime = 'edge'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/other/other.test.ts"]);
	});

	test("finds the fixture of a test at the root of the e2e directory", () => {
		write("test/e2e/prerender.test.ts");
		write("test/e2e/prerender/pages/a.tsx", `export const config = { runtime: 'edge' }`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/prerender.test.ts"]);
	});

	test("does not scan all tests for a test at the root of the app-dir directory", () => {
		write("test/e2e/app-dir/root.test.ts");
		write("test/e2e/app-dir/other/app/page.tsx", `export const runtime = 'edge'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual([]);
	});

	test("ignores an edge runtime declared by a sibling test file", () => {
		write("test/e2e/a/a.test.ts");
		write("test/e2e/a/b.test.ts", `export const runtime = 'edge'`);

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/a/b.test.ts"]);
	});

	test("keeps sibling test directories apart", () => {
		write("test/e2e/a/a.test.ts");
		write("test/e2e/a/app/page.tsx", `export const runtime = 'edge'`);
		write("test/e2e/b/b.test.ts");

		expect(findEdgeRuntimeTests(nextDir)).toEqual(["test/e2e/a/a.test.ts"]);
	});
});

test("disabledEdgeTests disables whole files with the reason", () => {
	expect(disabledEdgeTests(["test/e2e/a.test.ts"])).toEqual({
		"test/e2e/a.test.ts": { reason: "The edge runtime is not supported" },
	});
});
