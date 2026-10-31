import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { disabledFromJUnit, mergeDisabled, summarize } from "./junit.js";

const FILE = "test/e2e/a.test.ts";

type Case = { name: string; classname?: string; file?: string; body?: string };

function writeReport(cases: Case[], report = FILE): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-junit-"));
	const file = path.join(dir, "report.xml");
	const testcases = cases.map(
		({ name, classname = name, file = FILE, body = "" }) =>
			`<testcase classname="${classname}" name="${name}" file="${file}">${body}</testcase>`
	);
	fs.writeFileSync(
		file,
		`<?xml version="1.0"?><testsuites name="deploy:e2e:${report}"><testsuite name="s">${testcases.join("")}</testsuite></testsuites>`
	);
	return file;
}

const FAILURE = "<failure>boom</failure>";

describe("disabledFromJUnit", () => {
	test("lists failed case names per file", () => {
		const report = writeReport([{ name: "suite case", body: FAILURE }]);

		expect(disabledFromJUnit([report], "/x/next.js", "r")).toEqual({
			[FILE]: { reason: "r", cases: ["suite case"] },
		});
	});

	test("makes absolute paths relative to the Next checkout", () => {
		const report = writeReport([{ name: "suite case", file: `/x/next.js/${FILE}`, body: FAILURE }]);

		expect(Object.keys(disabledFromJUnit([report], "/x/next.js", "r"))).toEqual([FILE]);
	});

	test("omits passing and skipped cases", () => {
		const report = writeReport([{ name: "passing" }, { name: "skipped", body: "<skipped/>" }]);

		expect(disabledFromJUnit([report], "/x/next.js", "r")).toEqual({});
	});

	test("omits a case which passed on a retry", () => {
		const firstAttempt = writeReport([{ name: "flaky", body: FAILURE }]);
		const secondAttempt = writeReport([{ name: "flaky" }]);

		expect(disabledFromJUnit([firstAttempt, secondAttempt], "/x/next.js", "r")).toEqual({});
	});

	test("disables a whole file when it reports a suite-level error", () => {
		const report = writeReport([
			{ name: FILE, classname: "Test suite failed to run", body: "<error>boom</error>" },
		]);

		expect(disabledFromJUnit([report], "/x/next.js", "r")).toEqual({ [FILE]: { reason: "r" } });
	});

	test("finds the file of a suite-level error without a file attribute", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-junit-"));
		const report = path.join(dir, "report.xml");
		fs.writeFileSync(
			report,
			`<testsuites name="deploy:e2e:${FILE}"><testsuite name="s"><testcase classname="Test suite failed to run" name="/x/next.js/${FILE}"><error>boom</error></testcase></testsuite></testsuites>`
		);

		expect(disabledFromJUnit([report], "/x/next.js", "r")).toEqual({ [FILE]: { reason: "r" } });
	});

	test("sorts and de-duplicates cases", () => {
		const report = writeReport([
			{ name: "b", body: FAILURE },
			{ name: "a", body: FAILURE },
			{ name: "b", body: FAILURE },
		]);

		expect(disabledFromJUnit([report], "/x/next.js", "r")[FILE]?.cases).toEqual(["a", "b"]);
	});
});

describe("mergeDisabled", () => {
	test("keeps hand-written reasons and entries", () => {
		const existing = {
			"test/e2e/b.test.ts": { reason: "hand written" },
			[FILE]: { reason: "known issue", cases: ["a"] },
		};

		expect(mergeDisabled(existing, { [FILE]: { reason: "seeded", cases: ["a"] } })).toEqual(existing);
	});

	test("keeps a whole-file entry whole", () => {
		const merged = mergeDisabled({ [FILE]: { reason: "x" } }, { [FILE]: { reason: "y", cases: ["a"] } });

		expect(merged).toEqual({ [FILE]: { reason: "x" } });
	});

	test("widens case entries to the whole file when a run could not load it", () => {
		const merged = mergeDisabled({ [FILE]: { reason: "x", cases: ["a"] } }, { [FILE]: { reason: "y" } });

		expect(merged).toEqual({ [FILE]: { reason: "x" } });
	});

	test("unions the cases of an existing entry", () => {
		const merged = mergeDisabled(
			{ [FILE]: { reason: "x", cases: ["b"] } },
			{ [FILE]: { reason: "y", cases: ["a"] } }
		);

		expect(merged).toEqual({ [FILE]: { reason: "x", cases: ["a", "b"] } });
	});

	test("sorts by path so regenerated lists diff cleanly", () => {
		const merged = mergeDisabled(
			{ "test/z.test.ts": { reason: "x" } },
			{ "test/a.test.ts": { reason: "y" } }
		);

		expect(Object.keys(merged)).toEqual(["test/a.test.ts", "test/z.test.ts"]);
	});
});

describe("summarize", () => {
	test("counts the files and cases of a list", () => {
		const summary = summarize({
			"test/a.test.ts": { reason: "x" },
			"test/b.test.ts": { reason: "x", cases: ["one", "two"] },
		});

		expect(summary).toContain("1 whole file");
		expect(summary).toContain("2 cases in 1 file");
	});
});
