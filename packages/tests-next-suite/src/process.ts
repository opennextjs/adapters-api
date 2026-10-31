import { spawn } from "node:child_process";
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
export function startDetached({ command, cwd, env, logFile, pidFile }: StartDetachedOptions): number {
	const [file, ...args] = command as [string, ...string[]];
	const log = fs.openSync(logFile, "a");
	const child = spawn(file, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
	fs.closeSync(log);
	child.unref();
	fs.writeFileSync(pidFile, String(child.pid));
	return child.pid!;
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
 * Stops the process group recorded in a pid file, it does nothing if there is no such file.
 *
 * @param pidFile The file written by `startDetached`.
 * @param graceMs How long the group has to exit on SIGTERM before it gets SIGKILL.
 */
export async function stopProcessGroup(pidFile: string, graceMs = DEFAULT_GRACE_MS): Promise<void> {
	if (!fs.existsSync(pidFile)) {
		return;
	}
	const pid = Number(fs.readFileSync(pidFile, "utf8"));

	signalGroup(pid, "SIGTERM");
	await waitForGroupExit(pid, graceMs);
	signalGroup(pid, "SIGKILL");
	await waitForGroupExit(pid, KILL_WAIT_MS);

	fs.rmSync(pidFile);
}
