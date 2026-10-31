import path from "node:path";

import { ENV, toolchainEnv } from "./env.js";
import type { TargetName } from "./targets.js";

const UPSTREAM_MANIFEST = "test/deploy-tests-manifest.json";

/** How long a test may take to deploy its app, Cloudflare builds are a lot slower. */
const SETUP_TIMEOUT_MS: Record<TargetName, number> = { core: 240_000, cloudflare: 480_000 };

/**
 * The bundler of each target, selected through the variable Next.js reads.
 *
 * Cloudflare uses webpack as its Turbopack chunk loader generates broken paths for apps which are not in a
 * monorepo, and every app of the harness is standalone.
 */
const BUNDLER_ENV: Record<TargetName, Record<string, string>> = {
	core: { IS_TURBOPACK_TEST: "1" },
	cloudflare: { IS_WEBPACK_TEST: "1" },
};

export type RunSuiteArgsOptions = {
	group?: string;
	concurrency: number;
	tests: string[];
};

export type RunSuiteEnvOptions = {
	target: TargetName;
	pkgDir: string;
	base: NodeJS.ProcessEnv;
	tarballsDir: string;
	baseEnvFile: string;
	/** Where the harness creates apps, which has to be outside of this repository. */
	testAppsDir: string;
	/** The manifest of the disabled tests, `null` runs them too. */
	disabledManifest: string | null;
};

/**
 * Builds the `run-tests.js` command line.
 *
 * `--timings` is not used as it needs the Vercel KV store.
 *
 * @param options The tests to run.
 * @returns The arguments for `node`.
 */
export function buildRunSuiteArgs({ group, concurrency, tests }: RunSuiteArgsOptions): string[] {
	const selection = tests.length === 0 && group ? ["-g", group] : [];
	return ["run-tests.js", ...selection, "-c", String(concurrency), "--type", "e2e", ...tests];
}

/**
 * Builds the `run-tests.js` environment.
 *
 * @param options The target and where the run files are.
 * @returns The environment.
 */
export function buildRunSuiteEnv({
	target,
	pkgDir,
	base,
	tarballsDir,
	baseEnvFile,
	testAppsDir,
	disabledManifest,
}: RunSuiteEnvOptions): NodeJS.ProcessEnv {
	return {
		...toolchainEnv(base),
		NEXT_TEST_MODE: "deploy",
		NEXT_E2E_TEST_TIMEOUT: String(SETUP_TIMEOUT_MS[target]),
		NEXT_EXTERNAL_TESTS_FILTERS: [UPSTREAM_MANIFEST, ...(disabledManifest ? [disabledManifest] : [])].join(
			","
		),
		NEXT_JUNIT_TEST_REPORT: "1",
		...BUNDLER_ENV[target],
		NEXT_TEST_JOB: "1",
		NEXT_TELEMETRY_DISABLED: "1",
		NEXT_TEST_DIR: testAppsDir,
		NEXT_TEST_DEPLOY_SCRIPT_PATH: path.join(pkgDir, "bin/e2e-deploy.sh"),
		NEXT_TEST_DEPLOY_LOGS_SCRIPT_PATH: path.join(pkgDir, "bin/e2e-logs.sh"),
		NEXT_TEST_CLEANUP_SCRIPT_PATH: path.join(pkgDir, "bin/e2e-cleanup.sh"),
		[ENV.TARGET]: target,
		[ENV.TARBALLS_DIR]: tarballsDir,
		[ENV.BASE_ENV_FILE]: baseEnvFile,
	};
}
