import fs from "node:fs";
import path from "node:path";

export type DisabledEntry = {
	reason: string;
	/** Full jest names of the disabled cases, the whole file is disabled without it. */
	cases?: string[];
};

/** Tests disabled for one adapter, keyed by a path like `test/e2e/foo/foo.test.ts`. */
export type DisabledList = Record<string, DisabledEntry>;

/** The format of `NEXT_EXTERNAL_TESTS_FILTERS` files. */
export type SuiteManifest = {
	version: 2;
	suites: Record<string, { failed: string[] }>;
	rules: { include: string[]; exclude: string[] };
};

const TEST_PATH = /^test\/.+\.test\.(js|ts|tsx)$/;

function getEntryProblem(file: string, entry: Partial<DisabledEntry>): string | undefined {
	if (!TEST_PATH.test(file)) {
		return "the key must be a test path relative to the Next.js repository";
	}
	if (!entry.reason?.trim()) {
		return "a reason is required";
	}
	if (entry.cases?.length === 0) {
		return "cases can not be empty, remove it to disable the whole file";
	}
	return undefined;
}

/**
 * Loads a disable list.
 *
 * @param file The path of the list.
 * @returns The list.
 * @throws When an entry is invalid.
 */
export function loadDisabled(file: string): DisabledList {
	const list: Record<string, Partial<DisabledEntry>> = JSON.parse(fs.readFileSync(file, "utf8"));
	for (const [testFile, entry] of Object.entries(list)) {
		const problem = getEntryProblem(testFile, entry);
		if (problem) {
			throw new Error(`Invalid entry "${testFile}" in ${file}: ${problem}`);
		}
	}
	return list as DisabledList;
}

/**
 * Converts a disable list to the format the harness filters tests with.
 *
 * Whole files use exact paths, which take precedence over the manifests they are merged with.
 *
 * @param list The disable list.
 * @returns The manifest.
 */
export function toManifest(list: DisabledList): SuiteManifest {
	const manifest: SuiteManifest = { version: 2, suites: {}, rules: { include: [], exclude: [] } };
	for (const [file, { cases }] of Object.entries(list)) {
		if (cases) {
			manifest.suites[file] = { failed: cases };
		} else {
			manifest.rules.exclude.push(file);
		}
	}
	return manifest;
}

/**
 * Finds the entries which disable nothing, as happens when a Next.js update renames a test.
 *
 * @param list The disable list.
 * @param nextDir The Next.js checkout.
 * @returns The paths missing from the checkout.
 */
export function findStaleEntries(list: DisabledList, nextDir: string): string[] {
	return Object.keys(list).filter((file) => !fs.existsSync(path.join(nextDir, file)));
}
