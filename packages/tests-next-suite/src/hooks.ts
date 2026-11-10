import fs from "node:fs";
import path from "node:path";

import { ENV, hookEnv, testOnlyEnv } from "./env.js";
import { prepareApp } from "./prepare-app.js";
import { getFreePorts, runDetached, startDetached, stopProcessGroup, waitForHttp } from "./process.js";
import { REPO_ROOT, type Target } from "./targets.js";

export const BUILD_LOG = ".adapter-build.log";
export const SERVER_LOG = ".adapter-server.log";
export const PID_FILE = ".adapter-server.pid";
/** Written by the cleanup hook, the harness may give up on a deployment which is still in progress. */
const STOPPED_FILE = ".adapter-stopped";

const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_SETUP_TIMEOUT_MS = 240_000;
const START_ATTEMPTS = 3;
const LOG_TAIL_LINES = 40;
const INSTALL_COMMAND = ["pnpm", "install", "--no-frozen-lockfile", "--prefer-offline"];

export type HookDeps = {
	appDir: string;
	env: NodeJS.ProcessEnv;
	target: Target;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	readyTimeoutMs?: number;
	installCommand?: string[];
};

function readIfExists(file: string): string {
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function logTail(file: string): string {
	return readIfExists(file).trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`${name} is not set, the hooks must be started through the next-suite CLI`);
	}
	return value;
}

/**
 * Runs a command to completion with its output in the build log, as stdout belongs to the deployment URL.
 *
 * It is stoppable through the pid file, and has until the deadline: past it the harness has moved on.
 */
async function runLogged(
	command: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	deadline: number
): Promise<void> {
	const logFile = path.join(cwd, BUILD_LOG);
	const result = await runDetached({
		command,
		cwd,
		env,
		logFile,
		pidFile: path.join(cwd, PID_FILE),
		timeoutMs: Math.max(deadline - Date.now(), 0),
	});
	if (result === "timeout") {
		throw new Error(`\`${command.join(" ")}\` timed out:\n${logTail(logFile)}`);
	}
	if (result !== 0) {
		throw new Error(`\`${command.join(" ")}\` failed (exit code ${result}):\n${logTail(logFile)}`);
	}
}

/** Starts the server on free ports, a port taken in the meantime by a concurrent test only costs a retry. */
async function startServer(
	target: Target,
	appDir: string,
	env: NodeJS.ProcessEnv,
	readyTimeoutMs: number
): Promise<string> {
	const logFile = path.join(appDir, SERVER_LOG);
	const pidFile = path.join(appDir, PID_FILE);

	for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
		if (fs.existsSync(path.join(appDir, STOPPED_FILE))) {
			throw new Error("The deployment was stopped by the cleanup hook");
		}
		const [port, inspectorPort] = (await getFreePorts(2)) as [number, number];
		const url = `http://localhost:${port}`;
		const pid = startDetached({
			command: target.startCommand({ port, inspectorPort }),
			cwd: appDir,
			env: { ...env, PORT: String(port) },
			logFile,
			pidFile,
		});

		const result = await waitForHttp({ url, pid, timeoutMs: readyTimeoutMs });
		if (result === "ready") {
			return url;
		}
		await stopProcessGroup(pidFile);
		if (result === "timeout") {
			throw new Error(`The server did not become ready in ${readyTimeoutMs}ms:\n${logTail(logFile)}`);
		}
	}

	throw new Error(`The server exited during startup after ${START_ATTEMPTS} attempts:\n${logTail(logFile)}`);
}

/**
 * Builds and starts the app the harness created in `appDir`.
 *
 * @param deps The app, its target and where the output goes.
 * @throws When any step fails, nothing is left running then.
 */
export async function deploy({
	appDir,
	env,
	target,
	stdout,
	stderr,
	readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
	installCommand = INSTALL_COMMAND,
}: HookDeps): Promise<void> {
	const deadline = Date.now() + (Number(env.NEXT_E2E_TEST_TIMEOUT) || DEFAULT_SETUP_TIMEOUT_MS);
	const deploymentEnv = { ...hookEnv(env), NEXT_DEPLOYMENT_ID: `opennext-${path.basename(appDir)}` };
	const { packageManager } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
	const baseKeys: string[] = JSON.parse(fs.readFileSync(requireEnv(env, ENV.BASE_ENV_FILE), "utf8"));

	stderr(`Preparing the app for ${target.name}`);
	prepareApp({ appDir, target, tarballsDir: requireEnv(env, ENV.TARBALLS_DIR), packageManager });
	await runLogged(installCommand, appDir, deploymentEnv, deadline);

	stderr("Building the app");
	await runLogged(target.buildCommand, appDir, deploymentEnv, deadline);
	if (!/BUILD_ID: .+/.test(readIfExists(path.join(appDir, BUILD_LOG)))) {
		throw new Error(`The build output has no BUILD_ID marker, did the harness' post-build run?`);
	}

	target.prepareRuntimeEnv?.(appDir, testOnlyEnv(env, baseKeys));

	stderr("Starting the server");
	stdout(
		await startServer(
			target,
			appDir,
			{ ...deploymentEnv, NODE_ENV: "production", WRANGLER_SEND_METRICS: "false" },
			readyTimeoutMs
		)
	);
}

/**
 * Prints what the harness parses from a deployment, then the logs to debug it.
 *
 * `BUILD_ID`, `DEPLOYMENT_ID` and `IMMUTABLE_ASSET_TOKEN` are printed by the harness' `post-build` script
 * and end up in the build log. Depending on the Next.js version, the harness expects
 * `IMMUTABLE_ASSET_TOKEN` or `NEXT_SUPPORTS_IMMUTABLE_ASSETS`, so both are always there.
 *
 * @param appDir The app directory.
 * @returns The text for the harness.
 */
export function logs(appDir: string): string {
	const buildLog = readIfExists(path.join(appDir, BUILD_LOG));
	const immutableToken = /IMMUTABLE_ASSET_TOKEN: .+/.test(buildLog)
		? ""
		: "IMMUTABLE_ASSET_TOKEN: undefined\n";
	const serverLog = readIfExists(path.join(appDir, SERVER_LOG));
	return `NEXT_SUPPORTS_IMMUTABLE_ASSETS: 0\n${immutableToken}${buildLog}\n=== ${SERVER_LOG} ===\n${serverLog}`;
}

/**
 * Stops the server of a deployment.
 *
 * @param appDir The app directory.
 */
export async function cleanup(appDir: string): Promise<void> {
	fs.writeFileSync(path.join(appDir, STOPPED_FILE), "");
	await stopProcessGroup(path.join(appDir, PID_FILE));
}
