import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ENV } from "./env.js";
import { BUILD_LOG, PID_FILE, SERVER_LOG, cleanup, deploy, logs } from "./hooks.js";
import type { Target } from "./targets.js";

const NOOP = ["node", "-e", ""];
/** Prints what the harness' `post-build` script prints. */
const BUILD_OK = `console.log("BUILD_ID: abc\\nDEPLOYMENT_ID: " + process.env.NEXT_DEPLOYMENT_ID + "\\nIMMUTABLE_ASSET_TOKEN: undefined")`;
const SERVE = `require("node:http").createServer((_, res) => res.end("ok")).listen(process.env.PORT)`;

let appDir: string;
let tarballsDir: string;
let baseEnvFile: string;
let out: string[];
let err: string[];

function makeTarget(overrides: Partial<Target> = {}): Target {
	return {
		name: "core",
		packages: [],
		extraDependencies: {},
		templateFiles: [],
		buildCommand: ["node", "-e", BUILD_OK],
		startCommand: () => ["node", "-e", SERVE],
		...overrides,
	};
}

function runDeploy(target: Target, env: NodeJS.ProcessEnv = {}, readyTimeoutMs = 5000): Promise<void> {
	return deploy({
		appDir,
		target,
		env: {
			...process.env,
			NODE_ENV: undefined,
			[ENV.TARBALLS_DIR]: tarballsDir,
			[ENV.BASE_ENV_FILE]: baseEnvFile,
			...env,
		},
		stdout: (line) => out.push(line),
		stderr: (line) => err.push(line),
		installCommand: NOOP,
		readyTimeoutMs,
	});
}

function record(name: string, value: string): string {
	return `require("node:fs").writeFileSync(${JSON.stringify(path.join(appDir, name))}, String(${value}))`;
}

function read(name: string): string {
	return fs.readFileSync(path.join(appDir, name), "utf8");
}

beforeEach(() => {
	appDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-hooks-"));
	tarballsDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-hooks-tarballs-"));
	baseEnvFile = path.join(tarballsDir, "base-env.json");
	fs.writeFileSync(baseEnvFile, JSON.stringify(Object.keys(process.env)));
	fs.writeFileSync(path.join(appDir, "package.json"), "{}");
	out = [];
	err = [];
});

afterEach(async () => {
	await cleanup(appDir);
});

describe("deploy", () => {
	test("prints only the URL on stdout", async () => {
		const target = makeTarget({
			buildCommand: ["node", "-e", `console.log("noise"); ${BUILD_OK}`],
		});

		await runDeploy(target);

		expect(out).toHaveLength(1);
		expect(out[0]).toMatch(/^http:\/\/localhost:\d+$/);
	});

	test("serves on the printed URL", async () => {
		await runDeploy(makeTarget());

		expect(await (await fetch(out[0]!)).text()).toBe("ok");
	});

	test("strips NODE_ENV from build and start", async () => {
		const target = makeTarget({
			buildCommand: ["node", "-e", `${record("build-env", "process.env.NODE_ENV")}; ${BUILD_OK}`],
			startCommand: () => ["node", "-e", `${record("start-env", "process.env.NODE_ENV")}; ${SERVE}`],
		});

		await runDeploy(target, { NODE_ENV: "development" });

		expect(read("build-env")).toBe("undefined");
		expect(read("start-env")).toBe("production");
	});

	test("sets a per-app NEXT_DEPLOYMENT_ID for the build", async () => {
		await runDeploy(makeTarget());

		expect(read(BUILD_LOG)).toContain(`DEPLOYMENT_ID: opennext-${path.basename(appDir)}`);
	});

	test("retries on new ports when the server exits during startup", async () => {
		const marker = path.join(appDir, "started-once");
		const seenPorts = path.join(appDir, "ports");
		const script = `
			const fs = require("node:fs");
			fs.appendFileSync(${JSON.stringify(seenPorts)}, process.env.PORT + "\\n");
			if (!fs.existsSync(${JSON.stringify(marker)})) {
				fs.writeFileSync(${JSON.stringify(marker)}, "");
				process.exit(1);
			}
			${SERVE}
		`;

		await runDeploy(makeTarget({ startCommand: () => ["node", "-e", script] }));

		const ports = read("ports").trim().split("\n");
		expect(ports).toHaveLength(2);
		expect(ports[0]).not.toBe(ports[1]);
		expect(out[0]).toBe(`http://localhost:${ports[1]}`);
	});

	test("fails after 3 startup attempts with the server log tail", async () => {
		const target = makeTarget({
			startCommand: () => ["node", "-e", `console.error("cannot start"); process.exit(1)`],
		});

		await expect(runDeploy(target)).rejects.toThrow(/after 3 attempts[\s\S]*cannot start/);

		expect(out).toEqual([]);
	});

	test("reports a failed build with the build log tail and starts no server", async () => {
		const target = makeTarget({
			buildCommand: ["node", "-e", `console.error("build exploded"); process.exit(1)`],
			startCommand: () => ["node", "-e", `${record("started", "1")}; ${SERVE}`],
		});

		await expect(runDeploy(target)).rejects.toThrow(/build exploded/);

		expect(fs.existsSync(path.join(appDir, "started"))).toBe(false);
	});

	test("fails when the build output has no BUILD_ID marker", async () => {
		await expect(runDeploy(makeTarget({ buildCommand: NOOP }))).rejects.toThrow(/BUILD_ID/);
	});

	test("stops the server when it never becomes ready", async () => {
		const target = makeTarget({ startCommand: () => ["node", "-e", "setInterval(() => {}, 1000)"] });

		await expect(runDeploy(target, {}, 300)).rejects.toThrow(/did not become ready/);

		expect(fs.existsSync(path.join(appDir, PID_FILE))).toBe(false);
	});

	test("passes test-only env to prepareRuntimeEnv", async () => {
		const seen: Record<string, string>[] = [];
		const target = makeTarget({ prepareRuntimeEnv: (_dir, env) => seen.push(env) });

		await runDeploy(target, { FROM_THE_TEST: "bar" });

		expect(seen).toEqual([{ FROM_THE_TEST: "bar" }]);
	});
});

describe("logs", () => {
	test("emits both immutable-asset markers ahead of the replayed logs", () => {
		fs.writeFileSync(
			path.join(appDir, BUILD_LOG),
			"BUILD_ID: abc\nDEPLOYMENT_ID: d\nIMMUTABLE_ASSET_TOKEN: undefined\n"
		);
		fs.writeFileSync(path.join(appDir, SERVER_LOG), "listening\n");

		const output = logs(appDir);

		expect(output).toMatch(/BUILD_ID: abc/);
		expect(output).toMatch(/DEPLOYMENT_ID: d/);
		expect(output).toMatch(/IMMUTABLE_ASSET_TOKEN: .+/);
		expect(output).toMatch(/NEXT_SUPPORTS_IMMUTABLE_ASSETS: 0/);
		expect(output).toContain("listening");
	});

	test("adds IMMUTABLE_ASSET_TOKEN when the build output lacks it", () => {
		fs.writeFileSync(path.join(appDir, BUILD_LOG), "BUILD_ID: abc\nDEPLOYMENT_ID: d\n");

		expect(logs(appDir)).toMatch(/IMMUTABLE_ASSET_TOKEN: undefined/);
	});

	test("does not throw before a build log exists", () => {
		expect(() => logs(appDir)).not.toThrow();
	});
});
