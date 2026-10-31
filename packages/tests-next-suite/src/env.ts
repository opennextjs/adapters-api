/** Environment variables the CLI uses to configure the harness hooks. */
export const ENV = {
	TARGET: "OPEN_NEXT_SUITE_TARGET",
	TARBALLS_DIR: "OPEN_NEXT_SUITE_TARBALLS_DIR",
	BASE_ENV_FILE: "OPEN_NEXT_SUITE_BASE_ENV_FILE",
} as const;

const HARNESS_ENV_PREFIXES = ["NEXT_TEST_", "JEST_", "NODE_", "npm_", "PNPM_"];

/**
 * Returns the environment for commands run by the hooks.
 *
 * `NODE_ENV` is removed as an inherited `development` silently breaks `next build` prerendering.
 *
 * @param env The environment the hook was started with.
 * @returns A copy of the environment without `NODE_ENV`.
 */
export function hookEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const { NODE_ENV: _nodeEnv, ...rest } = env;
	return rest;
}

/**
 * Recovers the variables a test asked for.
 *
 * The harness merges them into `process.env`, so they are found by comparing against the environment
 * the CLI recorded before starting the run.
 *
 * @param env The environment the hook was started with.
 * @param baseKeys The variable names set before the run started.
 * @returns The variables added by the test.
 */
export function testOnlyEnv(env: NodeJS.ProcessEnv, baseKeys: string[]): Record<string, string> {
	const known = new Set(baseKeys);
	const entries = Object.entries(env).filter(
		(entry): entry is [string, string] =>
			entry[1] !== undefined &&
			!known.has(entry[0]) &&
			!HARNESS_ENV_PREFIXES.some((prefix) => entry[0].startsWith(prefix))
	);
	return Object.fromEntries(entries);
}
