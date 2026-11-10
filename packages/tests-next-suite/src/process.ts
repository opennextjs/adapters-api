import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const POLL_INTERVAL_MS = 250;
const STOP_POLL_INTERVAL_MS = 50;
const DEFAULT_GRACE_MS = 5000;
const KILL_WAIT_MS = 2000;

export type StartDetachedOptions = {
	command: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	logFile: string;
	pidFile: string;
};

export type RunDetachedOptions = StartDetachedOptions & {
	timeoutMs: number;
};

export type WaitForHttpOptions = {
	url: string;
	pid: number;
	timeoutMs: number;
};

function reservePort(): Promise<net.Server> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, () => resolve(server));
	});
}

/**
 * Finds free ports.
 *
 * All of them are held until the last one is found, so the same port is never returned twice.
 *
 * @param count The number of ports.
 * @returns The ports.
 */
export async function getFreePorts(count: number): Promise<number[]> {
	const servers = await Promise.all(Array.from({ length: count }, () => reservePort()));
	const ports = servers.map((server) => (server.address() as net.AddressInfo).port);
	await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
	return ports;
}

/**
 * Starts a command which outlives this process, in its own process group.
 *
 * @param options The command and the files receiving its output and pid.
 * @returns The pid, which is also the id of the process group.
 */
export function startDetached(options: StartDetachedOptions): number {
	const child = spawnGroup(options);
	child.unref();
	return child.pid!;
}

function spawnGroup({ command, cwd, env, logFile, pidFile }: StartDetachedOptions): ChildProcess {
	const [file, ...args] = command as [string, ...string[]];
	const log = fs.openSync(logFile, "a");
	const child = spawn(file, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
	fs.closeSync(log);
	if (child.pid !== undefined) {
		fs.writeFileSync(pidFile, String(child.pid));
	}
	return child;
}

/**
 * Runs a command to completion in its own process group, which `stopProcessGroup` can stop.
 *
 * @param options The command, the files receiving its output and pid and when to give up on it.
 * @returns The exit code, `null` when it was killed, or `"timeout"` when it was stopped at the deadline.
 */
export function runDetached({
	timeoutMs,
	...options
}: RunDetachedOptions): Promise<number | null | "timeout"> {
	return new Promise((resolve, reject) => {
		const child = spawnGroup(options);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			stopProcessGroup(options.pidFile).catch(reject);
		}, timeoutMs);

		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			fs.rmSync(options.pidFile, { force: true });
			resolve(timedOut ? "timeout" : code);
		});
	});
}

function isRunning(id: number): boolean {
	try {
		process.kill(id, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Waits for a server to answer, any HTTP status counts as apps do not always serve `/`.
 *
 * @param options The URL to poll, the server's pid and how long to wait.
 * @returns How the wait ended.
 */
export async function waitForHttp({
	url,
	pid,
	timeoutMs,
}: WaitForHttpOptions): Promise<"ready" | "exited" | "timeout"> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isRunning(pid)) {
			return "exited";
		}
		try {
			await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(POLL_INTERVAL_MS * 4) });
			return "ready";
		} catch {
			await sleep(POLL_INTERVAL_MS);
		}
	}
	return "timeout";
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
			throw error;
		}
	}
}

async function waitForGroupExit(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (isRunning(-pid) && Date.now() < deadline) {
		await sleep(STOP_POLL_INTERVAL_MS);
	}
}

/**
 * Reads the content of a pid file.
 *
 * It ends up negated in `process.kill`, where 0 is the group of the caller and -1 is every process.
 *
 * @param content The content of the file.
 * @returns The pid.
 * @throws When it is not the pid of a process which could have been started by this package.
 */
export function parsePid(content: string): number {
	const text = content.trim();
	if (!/^[1-9]\d*$/.test(text) || Number(text) <= 1) {
		throw new Error(`Invalid pid: "${content}"`);
	}
	return Number(text);
}

/**
 * Stops the process group recorded in a pid file, it does nothing if there is no such file.
 *
 * @param pidFile The file written by `startDetached`.
 * @param graceMs How long the group has to exit on SIGTERM before it gets SIGKILL.
 */
export async function stopProcessGroup(pidFile: string, graceMs = DEFAULT_GRACE_MS): Promise<void> {
	if (!fs.existsSync(pidFile)) {
		return;
	}
	const pid = parsePid(fs.readFileSync(pidFile, "utf8"));

	signalGroup(pid, "SIGTERM");
	await waitForGroupExit(pid, graceMs);
	signalGroup(pid, "SIGKILL");
	await waitForGroupExit(pid, KILL_WAIT_MS);

	fs.rmSync(pidFile, { force: true });
}
