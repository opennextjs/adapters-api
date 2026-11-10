import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	getFreePorts,
	parsePid,
	runDetached,
	startDetached,
	stopProcessGroup,
	waitForHttp,
} from "./process.js";

let dir: string;
let logFile: string;
let pidFile: string;
const spawned: number[] = [];

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForFile(file: string): Promise<string> {
	while (!fs.existsSync(file) || fs.readFileSync(file, "utf8") === "") {
		await sleep(20);
	}
	return fs.readFileSync(file, "utf8");
}

function start(script: string): number {
	const pid = startDetached({
		command: ["node", "-e", script],
		cwd: dir,
		env: process.env,
		logFile,
		pidFile,
	});
	spawned.push(pid);
	return pid;
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-process-"));
	logFile = path.join(dir, "server.log");
	pidFile = path.join(dir, "server.pid");
});

afterEach(() => {
	for (const pid of spawned.splice(0)) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
});

describe("getFreePorts", () => {
	test("returns distinct bindable ports", async () => {
		const [first, second] = (await getFreePorts(2)) as [number, number];

		expect(first).not.toBe(second);
		const server = http.createServer();
		await new Promise<void>((resolve) => server.listen(first, resolve));
		expect((server.address() as AddressInfo).port).toBe(first);
		server.close();
	});
});

describe("startDetached", () => {
	test("sends the output to the log file and records the pid", async () => {
		const pid = start("console.log('hello'); console.error('oops')");

		expect(fs.readFileSync(pidFile, "utf8")).toBe(String(pid));
		await expect.poll(() => fs.readFileSync(logFile, "utf8")).toContain("hello");
		expect(fs.readFileSync(logFile, "utf8")).toContain("oops");
	});
});

describe("parsePid", () => {
	test("accepts a process id", () => {
		expect(parsePid("12345")).toBe(12345);
		expect(parsePid("12345\n")).toBe(12345);
	});

	// 0 is the caller's own group and -1 is every process, so these must never reach `process.kill`.
	test.each(["", " ", "0", "1", "-5", "abc", "12.5", "0x10"])("refuses %j", (content) => {
		expect(() => parsePid(content)).toThrow(/Invalid pid/);
	});
});

describe("runDetached", () => {
	const run = (script: string, timeoutMs = 5000) =>
		runDetached({ command: ["node", "-e", script], cwd: dir, env: process.env, logFile, pidFile, timeoutMs });

	test("resolves with the exit code and clears the pid file", async () => {
		await expect(run("process.exit(3)")).resolves.toBe(3);

		expect(fs.existsSync(pidFile)).toBe(false);
	});

	test("records the pid while running, so that cleanup can stop it", async () => {
		const running = run("setInterval(() => {}, 1000)");
		await waitForFile(pidFile);

		await stopProcessGroup(pidFile);

		await expect(running).resolves.not.toBe(0);
	});

	test("stops the group at the deadline", async () => {
		await expect(run("setInterval(() => {}, 1000)", 200)).resolves.toBe("timeout");

		expect(fs.existsSync(pidFile)).toBe(false);
	});
});

describe("waitForHttp", () => {
	test("treats any HTTP status as ready", async () => {
		const server = http.createServer((_req, res) => res.writeHead(404).end());
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const { port } = server.address() as AddressInfo;

		const result = await waitForHttp({
			url: `http://localhost:${port}`,
			pid: process.pid,
			timeoutMs: 5000,
		});

		expect(result).toBe("ready");
		server.close();
	});

	test("reports a process that exits early without waiting for the timeout", async () => {
		const [port] = (await getFreePorts(1)) as [number];
		const pid = start("process.exit(1)");
		const startedAt = Date.now();

		const result = await waitForHttp({ url: `http://localhost:${port}`, pid, timeoutMs: 30_000 });

		expect(result).toBe("exited");
		expect(Date.now() - startedAt).toBeLessThan(2000);
	});

	test("reports timeout", async () => {
		const [port] = (await getFreePorts(1)) as [number];
		const pid = start("setInterval(() => {}, 1000)");

		const result = await waitForHttp({ url: `http://localhost:${port}`, pid, timeoutMs: 300 });

		expect(result).toBe("timeout");
	});
});

describe("stopProcessGroup", () => {
	test("kills grandchildren", async () => {
		const grandchildPidFile = path.join(dir, "grandchild.pid");
		const pid = start(`
			const { spawn } = require("node:child_process");
			const child = spawn("node", ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
			require("node:fs").writeFileSync(${JSON.stringify(grandchildPidFile)}, String(child.pid));
			setInterval(() => {}, 1000);
		`);
		const grandchild = Number(await waitForFile(grandchildPidFile));

		await stopProcessGroup(pidFile);

		expect(isAlive(pid)).toBe(false);
		expect(isAlive(grandchild)).toBe(false);
	});

	test("escalates to SIGKILL when SIGTERM is ignored", async () => {
		const readyFile = path.join(dir, "ready");
		const pid = start(`
			process.on("SIGTERM", () => {});
			require("node:fs").writeFileSync(${JSON.stringify(readyFile)}, "ready");
			setInterval(() => {}, 1000);
		`);
		await waitForFile(readyFile);

		await stopProcessGroup(pidFile, 200);

		expect(isAlive(pid)).toBe(false);
	});

	test("is a no-op with no pid file", async () => {
		await expect(stopProcessGroup(pidFile)).resolves.toBeUndefined();
	});

	test("refuses a corrupt pid file", async () => {
		fs.writeFileSync(pidFile, "abc");

		await expect(stopProcessGroup(pidFile)).rejects.toThrow(/Invalid pid/);
	});

	test("can run twice", async () => {
		start("setInterval(() => {}, 1000)");

		await stopProcessGroup(pidFile);

		await expect(stopProcessGroup(pidFile)).resolves.toBeUndefined();
	});
});
