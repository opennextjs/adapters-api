import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getFreePorts, startDetached, stopProcessGroup, waitForHttp } from "./process.js";

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

	test("can run twice", async () => {
		start("setInterval(() => {}, 1000)");

		await stopProcessGroup(pidFile);

		await expect(stopProcessGroup(pidFile)).resolves.toBeUndefined();
	});
});
