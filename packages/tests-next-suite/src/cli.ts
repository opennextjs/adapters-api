import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { findStaleEntries, loadDisabled, toManifest } from "./disabled.js";
import { disabledFromJUnit, mergeDisabled, summarize } from "./junit.js";
import { DEFAULT_NEXT_REF, ensureNextCheckout, packTarballs } from "./next-checkout.js";
import { buildRunSuiteArgs, buildRunSuiteEnv } from "./run-suite.js";
import { PACKAGE_DIR, getTarget, type TargetName } from "./targets.js";

const CACHE_DIR = path.join(PACKAGE_DIR, ".cache");
const TEST_APPS_DIR = path.join(os.homedir(), ".cache/opennext-next-suite/apps");

const USAGE = `Usage:
  pnpm next-suite setup [--ref <ref>]
  pnpm next-suite run --target <core|cloudflare> [--group 1/16] [-c 2] [--ref <ref>] [--include-disabled] [test paths...]
  pnpm next-suite disabled-from-junit --target <core|cloudflare> --input <dir> --output <file> --reason <text>`;

/** Resolves the Next.js checkout, set `NEXT_SUITE_NEXT_DIR` to use an existing built one. */
function resolveNextDir(ref: string): string {
	const existing = process.env.NEXT_SUITE_NEXT_DIR;
	if (existing) {
		return path.resolve(existing);
	}
	const dir = path.join(CACHE_DIR, "next.js");
	ensureNextCheckout(ref, dir);
	return dir;
}

/** Writes the harness manifest of a target's disabled tests. */
function writeDisabledManifest(target: TargetName, nextDir: string): string {
	const list = loadDisabled(path.join(PACKAGE_DIR, "disabled", `${target}.json`));
	for (const file of findStaleEntries(list, nextDir)) {
		console.error(`Warning: ${file} is disabled for ${target} but does not exist in this Next.js version`);
	}
	const manifest = path.join(CACHE_DIR, `disabled-${target}.json`);
	fs.writeFileSync(manifest, JSON.stringify(toManifest(list), null, 2));
	return manifest;
}

function run(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			target: { type: "string" },
			group: { type: "string" },
			concurrency: { type: "string", short: "c", default: "2" },
			ref: { type: "string", default: DEFAULT_NEXT_REF },
			"include-disabled": { type: "boolean", default: false },
		},
	});
	const target = getTarget(values.target).name;
	const nextDir = resolveNextDir(values.ref);

	fs.mkdirSync(CACHE_DIR, { recursive: true });
	fs.mkdirSync(TEST_APPS_DIR, { recursive: true });
	const tarballsDir = path.join(CACHE_DIR, "tarballs");
	packTarballs(tarballsDir);

	const baseEnvFile = path.join(CACHE_DIR, "base-env.json");
	const env = buildRunSuiteEnv({
		target,
		pkgDir: PACKAGE_DIR,
		base: process.env,
		tarballsDir,
		baseEnvFile,
		testAppsDir: TEST_APPS_DIR,
		disabledManifest: values["include-disabled"] ? null : writeDisabledManifest(target, nextDir),
	});
	fs.writeFileSync(baseEnvFile, JSON.stringify(Object.keys(env)));

	const { status } = spawnSync(
		process.execPath,
		buildRunSuiteArgs({ group: values.group, concurrency: Number(values.concurrency), tests: positionals }),
		{ cwd: nextDir, env, stdio: "inherit" }
	);
	return status ?? 1;
}

function setup(args: string[]): number {
	const { values } = parseArgs({ args, options: { ref: { type: "string", default: DEFAULT_NEXT_REF } } });
	resolveNextDir(values.ref);
	return 0;
}

/** Writes the target's disable list with what failed in the JUnit reports of `input` added to it. */
function seedDisabled(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: {
			target: { type: "string" },
			input: { type: "string" },
			output: { type: "string" },
			reason: { type: "string" },
		},
	});
	const { reason } = values;
	if (!values.input || !values.output || !reason) {
		console.error(USAGE);
		return 1;
	}
	// pnpm runs this script from the package, the paths are relative to where it was called from.
	const callerDir = process.env.INIT_CWD ?? process.cwd();
	const input = path.resolve(callerDir, values.input);
	const output = path.resolve(callerDir, values.output);

	const target = getTarget(values.target).name;
	const reports = fs
		.readdirSync(input, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".xml"))
		.map((file) => path.join(input, file));
	const found = disabledFromJUnit(reports, path.join(CACHE_DIR, "next.js"), reason);
	const list = mergeDisabled(loadDisabled(path.join(PACKAGE_DIR, "disabled", `${target}.json`)), found);

	fs.writeFileSync(output, `${JSON.stringify(list, null, "\t")}\n`);
	console.log(`### ${target}: ${reports.length} reports\n\n${summarize(list)}`);
	return 0;
}

function main([command, ...args]: string[]): number {
	switch (command) {
		case "setup":
			return setup(args);
		case "run":
			return run(args);
		case "disabled-from-junit":
			return seedDisabled(args);
		default:
			console.error(USAGE);
			return 1;
	}
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
