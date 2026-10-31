import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { TARGETS, getTarget } from "./targets.js";

describe("TARGETS", () => {
	test("core builds with the open-next CLI and serves the bundled server", () => {
		expect(TARGETS.core.packages).toEqual(["@opennextjs/aws", "@opennextjs/core"]);
		expect(TARGETS.core.buildCommand).toEqual(["pnpm", "exec", "open-next", "build"]);
		expect(TARGETS.core.startCommand({ port: 4000, inspectorPort: 4001 })).toEqual([
			"node",
			".open-next/server-functions/default/index.mjs",
		]);
	});

	test("cloudflare previews through wrangler on the given ports", () => {
		expect(TARGETS.cloudflare.packages).toEqual(["@opennextjs/cloudflare", "@opennextjs/core"]);
		expect(TARGETS.cloudflare.startCommand({ port: 4000, inspectorPort: 4001 })).toEqual([
			"pnpm",
			"exec",
			"opennextjs-cloudflare",
			"preview",
			"--port",
			"4000",
			"--inspector-port",
			"4001",
		]);
	});

	test("cloudflare writes test-only env to .dev.vars with values quoted", () => {
		const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-targets-"));

		TARGETS.cloudflare.prepareRuntimeEnv!(appDir, { PLAIN: "value", TRICKY: 'line one\nsay "hi"' });

		expect(fs.readFileSync(path.join(appDir, ".dev.vars"), "utf8")).toBe(
			'PLAIN="value"\nTRICKY="line one\\nsay \\"hi\\""\n'
		);
	});
});

describe("getTarget", () => {
	test("returns a known target", () => {
		expect(getTarget("core").name).toBe("core");
	});

	test("rejects unknown and missing names", () => {
		expect(() => getTarget("aws")).toThrow(/core, cloudflare/);
		expect(() => getTarget(undefined)).toThrow(/core, cloudflare/);
	});
});
