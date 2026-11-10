import fs from "node:fs";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";

import type { DisabledEntry, DisabledList } from "./disabled.js";

const SUITE_ERROR_CASE = "Test suite failed to run";
const HOOK_ERROR_CASE = "Test execution failure";
const REPORT_NAME_PREFIX = "deploy:e2e:";

type TestCase = {
	name: string;
	classname?: string;
	file?: string;
	failure?: unknown;
	error?: unknown;
	skipped?: unknown;
};
type TestSuite = { testcase?: TestCase[] };
type Report = { testsuites?: { name?: string; testsuite?: TestSuite[] } };

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	// Case names have to match exactly, some end with a space.
	trimValues: false,
	// The limit protects against hostile documents, these reports have long failure messages.
	processEntities: { enabled: true, maxTotalExpansions: Number.MAX_SAFE_INTEGER },
	isArray: (name) => name === "testsuite" || name === "testcase",
});

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values)].sort(compare);
}

function readCases(xmlFile: string, nextDir: string): { file: string; testCase: TestCase }[] {
	const { testsuites }: Report = parser.parse(fs.readFileSync(xmlFile, "utf8"));
	const reportFile = testsuites?.name?.replace(REPORT_NAME_PREFIX, "");
	return (testsuites?.testsuite ?? []).flatMap((suite) =>
		(suite.testcase ?? []).flatMap((testCase) => {
			const file = testCase.file ?? reportFile;
			if (!file) {
				return [];
			}
			return [{ file: path.isAbsolute(file) ? path.relative(nextDir, file) : file, testCase }];
		})
	);
}

/**
 * Lists what failed in JUnit reports as disable entries.
 *
 * `run-tests.js` writes a report per attempt, a case passing on any attempt is not a failure.
 *
 * @param xmlFiles The JUnit reports.
 * @param nextDir The Next.js checkout, absolute paths are made relative to it.
 * @param reason The reason set on the entries.
 * @returns The entries.
 */
export function disabledFromJUnit(xmlFiles: string[], nextDir: string, reason: string): DisabledList {
	const failed = new Map<string, string[]>();
	const passed = new Set<string>();
	const brokenFiles = new Set<string>();

	for (const { file, testCase } of xmlFiles.flatMap((xmlFile) => readCases(xmlFile, nextDir))) {
		// jest-junit joins the describe blocks and the title with a space, even without describe blocks.
		const name = testCase.name.replace(/^ /, "");
		if (testCase.classname === SUITE_ERROR_CASE || testCase.name.includes(HOOK_ERROR_CASE)) {
			brokenFiles.add(file);
		} else if (testCase.failure !== undefined || testCase.error !== undefined) {
			failed.set(file, [...(failed.get(file) ?? []), name]);
		} else if (testCase.skipped === undefined) {
			passed.add(`${file}\0${name}`);
		}
	}

	const list: DisabledList = {};
	for (const [file, names] of failed) {
		const cases = sortedUnique(names.filter((name) => !passed.has(`${file}\0${name}`)));
		if (cases.length > 0) {
			list[file] = { reason, cases };
		}
	}
	for (const file of brokenFiles) {
		list[file] = { reason };
	}
	return list;
}

function mergeEntries(existing: DisabledEntry, found: DisabledEntry): DisabledEntry {
	if (!existing.cases || !found.cases) {
		return { reason: existing.reason };
	}
	return { reason: existing.reason, cases: sortedUnique([...existing.cases, ...found.cases]) };
}

/**
 * Adds new entries to a list, what is in the list is kept and wins over what was found.
 *
 * @param existing The current list.
 * @param found The entries to add.
 * @returns The merged list, sorted by path.
 */
export function mergeDisabled(existing: DisabledList, found: DisabledList): DisabledList {
	const merged: DisabledList = { ...found, ...existing };
	for (const [file, entry] of Object.entries(found)) {
		const current = existing[file];
		if (current) {
			merged[file] = mergeEntries(current, entry);
		}
	}
	return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => compare(a, b)));
}

/**
 * Describes a list in Markdown.
 *
 * @param list The list.
 * @returns The summary.
 */
export function summarize(list: DisabledList): string {
	const entries = Object.values(list);
	const partial = entries.filter((entry) => entry.cases);
	const caseCount = partial.reduce((total, entry) => total + entry.cases!.length, 0);
	const wholeFiles = entries.length - partial.length;
	return [
		`- ${wholeFiles} whole file${wholeFiles === 1 ? "" : "s"}`,
		`- ${caseCount} case${caseCount === 1 ? "" : "s"} in ${partial.length} file${partial.length === 1 ? "" : "s"}`,
	].join("\n");
}
