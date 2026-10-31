import path from "node:path";

import { describe, expect, test } from "vitest";

import { buildRunSuiteArgs, buildRunSuiteEnv } from "./run-suite.js";

const options = { pkgDir: "/p", tarballsDir: "/t", baseEnvFile: "/b", testAppsDir: "/apps" };

describe("buildRunSuiteArgs", () => {
	test("never requests KV timings", () => {
		expect(buildRunSuiteArgs({ group: "3/16", concurrency: 2, tests: [] })).toEqual([
			"run-tests.js",
			"-g",
			"3/16",
			"-c",
			"2",
			"--type",
			"e2e",
		]);
	});

	test("explicit test paths replace the group", () => {
		expect(
			buildRunSuiteArgs({ concurrency: 1, tests: ["test/e2e/hello-world/hello-world.test.ts"] })
		).toEqual(["run-tests.js", "-c", "1", "--type", "e2e", "test/e2e/hello-world/hello-world.test.ts"]);
	});
});

describe("buildRunSuiteEnv", () => {
	test("layers the target's disabled manifest on the upstream one", () => {
		const env = buildRunSuiteEnv({
			...options,
			target: "core",
			base: {},
			disabledManifest: "/p/.cache/disabled-core.json",
		});

		expect(env.NEXT_EXTERNAL_TESTS_FILTERS).toBe(
			"test/deploy-tests-manifest.json,/p/.cache/disabled-core.json"
		);
		expect(env.NEXT_TEST_MODE).toBe("deploy");
		expect(env.IS_TURBOPACK_TEST).toBe("1");
		expect(env.NEXT_JUNIT_TEST_REPORT).toBe("1");
		expect(env.NEXT_TEST_DEPLOY_SCRIPT_PATH).toBe("/p/bin/e2e-deploy.sh");
		expect(env.NEXT_TEST_DEPLOY_LOGS_SCRIPT_PATH).toBe("/p/bin/e2e-logs.sh");
		expect(env.NEXT_TEST_CLEANUP_SCRIPT_PATH).toBe("/p/bin/e2e-cleanup.sh");
	});

	test("--include-disabled keeps only the upstream filter", () => {
		const env = buildRunSuiteEnv({ ...options, target: "core", base: {}, disabledManifest: null });

		expect(env.NEXT_EXTERNAL_TESTS_FILTERS).toBe("test/deploy-tests-manifest.json");
	});

	test("creates test apps outside the repository", () => {
		const env = buildRunSuiteEnv({ ...options, target: "core", base: {}, disabledManifest: null });

		expect(env.NEXT_TEST_DIR).toBe("/apps");
	});

	test("strips NODE_ENV", () => {
		const env = buildRunSuiteEnv({
			...options,
			target: "core",
			base: { NODE_ENV: "development" },
			disabledManifest: null,
		});

		expect(env.NODE_ENV).toBeUndefined();
	});

	test("pins the toolchain", () => {
		const env = buildRunSuiteEnv({
			...options,
			target: "core",
			base: { PATH: "/usr/bin" },
			disabledManifest: null,
		});

		expect(env.PATH).toBe(`${path.dirname(process.execPath)}:/usr/bin`);
	});

	test.each([
		["core", "240000"],
		["cloudflare", "480000"],
	] as const)("gives %s a %sms setup timeout", (target, timeout) => {
		const env = buildRunSuiteEnv({ ...options, target, base: {}, disabledManifest: null });

		expect(env.NEXT_E2E_TEST_TIMEOUT).toBe(timeout);
	});
});
