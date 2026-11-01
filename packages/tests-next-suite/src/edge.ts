import fs from "node:fs";
import path from "node:path";

import type { DisabledList } from "./disabled.js";

const REASON = "The edge runtime is not supported";
const EDGE_RUNTIME = /\bruntime\s*[:=]\s*["'](experimental-)?edge["']/;
const SOURCE_FILE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const TEST_FILE = /\.test\.(js|ts|tsx)$/;
/** Middleware runs in the edge sandbox whatever it declares, and is supported. */
const MIDDLEWARE_FILE = /^(middleware|proxy)\.[a-z]+$/;
const IGNORED_DIRS = new Set(["node_modules", ".next"]);
const ROOT_DIRS = new Set(["test/e2e", "test/e2e/app-dir"]);

function listFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return IGNORED_DIRS.has(entry.name) ? [] : listFiles(file);
		}
		return [file];
	});
}

function declaresEdgeRuntime(file: string): boolean {
	return (
		SOURCE_FILE.test(file) &&
		!MIDDLEWARE_FILE.test(path.basename(file)) &&
		EDGE_RUNTIME.test(fs.readFileSync(file, "utf8"))
	);
}

/**
 * Returns the directory of a test's fixture, if it has one.
 *
 * Tests can be in a `test` directory next to the app. The fixture of a test at the root of a directory
 * holding other tests is named after it, as the directory itself holds the apps of all the others.
 */
function getFixtureDir(testFile: string, nextDir: string): string | undefined {
	const dir = path.dirname(testFile);
	const fixture = ["test", "tests"].includes(path.basename(dir)) ? path.dirname(dir) : dir;
	if (![...ROOT_DIRS].some((root) => fixture === path.join(nextDir, root))) {
		return fixture;
	}
	const named = path.join(fixture, path.basename(testFile).replace(TEST_FILE, ""));
	return fs.existsSync(named) ? named : undefined;
}

/**
 * Finds the e2e tests with an app declaring the edge runtime.
 *
 * The apps of a directory are shared by its tests, an app inlined in a test file only concerns that test.
 *
 * @param nextDir The Next.js checkout.
 * @returns The test paths relative to the checkout, sorted.
 */
export function findEdgeRuntimeTests(nextDir: string): string[] {
	const edgeDirs = new Map<string, boolean>();
	const usesEdgeRuntime = (dir: string): boolean => {
		const known = edgeDirs.get(dir);
		if (known !== undefined) {
			return known;
		}
		const result = listFiles(dir).some((file) => !TEST_FILE.test(file) && declaresEdgeRuntime(file));
		edgeDirs.set(dir, result);
		return result;
	};

	return listFiles(path.join(nextDir, "test/e2e"))
		.filter((file) => TEST_FILE.test(file))
		.filter((file) => {
			const fixture = getFixtureDir(file, nextDir);
			return declaresEdgeRuntime(file) || (fixture !== undefined && usesEdgeRuntime(fixture));
		})
		.map((file) => path.relative(nextDir, file))
		.sort();
}

/**
 * Builds the disable entries of edge runtime tests.
 *
 * @param files The test paths.
 * @returns The entries.
 */
export function disabledEdgeTests(files: string[]): DisabledList {
	return Object.fromEntries(files.map((file) => [file, { reason: REASON }]));
}
