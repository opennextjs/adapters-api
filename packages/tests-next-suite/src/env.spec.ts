import { describe, expect, test } from "vitest";

import { toolchainEnv } from "./env.js";

const linux = { execPath: "/node/24/bin/node", platform: "linux", arch: "x64" } as const;

describe("toolchainEnv", () => {
	test("puts the running Node first so version managers do not switch it inside the checkout", () => {
		expect(toolchainEnv({ PATH: "/shims:/usr/bin" }, linux).PATH).toBe("/node/24/bin:/shims:/usr/bin");
	});

	test("tolerates a missing PATH", () => {
		expect(toolchainEnv({}, linux).PATH).toBe("/node/24/bin");
	});

	test("strips NODE_ENV", () => {
		expect(toolchainEnv({ NODE_ENV: "development" }, linux).NODE_ENV).toBeUndefined();
	});

	test("makes the older Playwright pinned by Next.js accept newer Linux distributions", () => {
		expect(toolchainEnv({}, linux).PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBe("ubuntu24.04-x64");
	});

	test("keeps an explicit Playwright platform", () => {
		const env = toolchainEnv({ PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: "debian12-x64" }, linux);

		expect(env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBe("debian12-x64");
	});

	test("leaves Playwright alone elsewhere", () => {
		const mac = { execPath: "/node/bin/node", platform: "darwin", arch: "arm64" } as const;

		expect(toolchainEnv({}, mac).PLAYWRIGHT_HOST_PLATFORM_OVERRIDE).toBeUndefined();
	});
});
