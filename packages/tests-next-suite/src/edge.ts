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

/** Returns the directory of a test's fixture, tests can be in a `test` directory next to the app. */
function getFixtureDir(testFile: string): string {
	const dir = path.dirname(testFile);
	return ["test", "tests"].includes(path.basename(dir)) ? path.dirname(dir) : dir;
}

/**
 * Finds the e2e tests with an app declaring the edge runtime.
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
		const result = listFiles(dir).some(declaresEdgeRuntime);
		edgeDirs.set(dir, result);
		return result;
	};

	return listFiles(path.join(nextDir, "test/e2e"))
		.filter((file) => TEST_FILE.test(file) && usesEdgeRuntime(getFixtureDir(file)))
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
