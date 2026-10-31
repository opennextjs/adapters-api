import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { findStaleEntries, loadDisabled, toManifest } from "./disabled.js";
import { PACKAGE_DIR } from "./targets.js";

function writeList(content: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-disabled-"));
	const file = path.join(dir, "list.json");
	fs.writeFileSync(file, JSON.stringify(content));
	return file;
}

describe("toManifest", () => {
	test("a file entry becomes an exact-path exclusion", () => {
		expect(toManifest({ "test/e2e/a.test.ts": { reason: "x" } })).toEqual({
			version: 2,
			suites: {},
			rules: { include: [], exclude: ["test/e2e/a.test.ts"] },
		});
	});

	test("a case entry excludes only those cases", () => {
		expect(toManifest({ "test/e2e/a.test.ts": { reason: "x", cases: ["suite case"] } })).toEqual({
			version: 2,
			suites: { "test/e2e/a.test.ts": { failed: ["suite case"] } },
			rules: { include: [], exclude: [] },
		});
	});

	test("an empty list still yields a mergeable manifest", () => {
		expect(toManifest({}).rules).toEqual({ include: [], exclude: [] });
	});
});

describe("loadDisabled", () => {
	test("returns a valid list", () => {
		const list = { "test/e2e/a.test.ts": { reason: "x", cases: ["suite case"] } };

		expect(loadDisabled(writeList(list))).toEqual(list);
	});

	test.each([
		["a missing reason", "test/e2e/a.test.ts", {}],
		["a blank reason", "test/e2e/a.test.ts", { reason: " " }],
		["an empty cases array", "test/e2e/a.test.ts", { reason: "x", cases: [] }],
		["an absolute path", "/x/test/e2e/a.test.ts", { reason: "x" }],
		["a non-test path", "test/e2e/a.ts", { reason: "x" }],
	])("rejects %s, naming the entry", (_name, file, entry) => {
		expect(() => loadDisabled(writeList({ [file]: entry }))).toThrow(file);
	});
});

describe("findStaleEntries", () => {
	test("reports paths missing from the Next checkout", () => {
		const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-checkout-"));
		fs.mkdirSync(path.join(nextDir, "test/e2e"), { recursive: true });
		fs.writeFileSync(path.join(nextDir, "test/e2e/a.test.ts"), "");

		const stale = findStaleEntries(
			{ "test/e2e/a.test.ts": { reason: "x" }, "test/e2e/gone.test.ts": { reason: "x" } },
			nextDir
		);

		expect(stale).toEqual(["test/e2e/gone.test.ts"]);
	});
});

test.each(["core", "cloudflare"])("the committed %s list is valid", (target) => {
	expect(() => loadDisabled(path.join(PACKAGE_DIR, "disabled", `${target}.json`))).not.toThrow();
});
