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
