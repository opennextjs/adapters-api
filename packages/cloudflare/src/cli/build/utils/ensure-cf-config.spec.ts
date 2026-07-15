import { describe, expect, test } from "vitest";

import { defineCloudflareConfig } from "../../../api/config.js";

import { ensureCloudflareConfig } from "./ensure-cf-config.js";

describe("ensureCloudflareConfig", () => {
	test("accepts the container topology", () => {
		expect(() => ensureCloudflareConfig(defineCloudflareConfig({ container: true }))).not.toThrow();
	});

	test("rejects binding-backed caches in container mode", () => {
		const config = defineCloudflareConfig({ container: true });
		config.default.override!.incrementalCache = () => ({ name: "unsupported" }) as never;

		expect(() => ensureCloudflareConfig(config)).toThrow("Cloudflare Containers");
	});
});
