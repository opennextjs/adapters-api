import { describe, expect, test } from "vitest";

import { ensureNextjsVersionSupported } from "./nextjs-support.js";

describe("ensureNextjsVersionSupported", () => {
	test("rejects versions without the routing-aware adapter contract", async () => {
		await expect(ensureNextjsVersionSupported({ nextVersion: "16.2.0" })).rejects.toThrow(
			"please upgrade to version 16.2.1 or greater"
		);
	});

	test("accepts the version required by the adapter peer dependency", async () => {
		await expect(ensureNextjsVersionSupported({ nextVersion: "16.2.1" })).resolves.toBeUndefined();
	});
});
