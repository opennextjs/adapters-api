import { describe, expect, test } from "vitest";

import { defineCloudflareConfig } from "./config.js";

describe("defineCloudflareConfig", () => {
	test("uses the Worker defaults by default", () => {
		const config = defineCloudflareConfig();

		expect(config.cloudflare?.container).toBe(false);
		expect(config.default.override).toMatchObject({
			wrapper: "cloudflare-node",
			converter: "edge",
			proxyExternalRequest: "fetch",
		});
	});

	test("configures a Node.js container default function", () => {
		const config = defineCloudflareConfig({ container: true });

		expect(config.cloudflare?.container).toBe(true);
		expect(config.default.override).toEqual({
			wrapper: "node",
			converter: "node",
			generateDockerfile: true,
			incrementalCache: "dummy",
			tagCache: "dummy",
			queue: "dummy",
		});
		expect(config.middleware).toMatchObject({
			external: true,
			override: {
				wrapper: "cloudflare-edge",
				converter: "edge",
				proxyExternalRequest: "fetch",
			},
		});
	});

	test("rejects Cloudflare binding-backed overrides for containers", () => {
		expect(() =>
			defineCloudflareConfig({
				container: true,
				incrementalCache: () => ({ name: "unsupported" }) as never,
			})
		).toThrow("Container mode");
	});
});
