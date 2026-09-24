import { hasHardRevalidation } from "../../../../aws/src/overrides/tagCache/dynamodb-nextMode.js";
import fsDevTagCache from "@opennextjs/core/overrides/tagCache/fs-dev-nextMode";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("next-mode SWR tag revalidation", () => {
	beforeEach(() => {
		vi.useFakeTimers().setSystemTime(2_000);
		globalThis.openNextConfig = { dangerous: {} };
	});

	it("does not hard-invalidate DynamoDB records before their expiry", () => {
		expect(
			hasHardRevalidation(
				{ revalidatedAt: { N: "1500" }, stale: { N: "1500" }, expire: { N: "3000" } },
				1_000,
				2_000
			)
		).toBe(false);
	});

	it("hard-invalidates DynamoDB records after their expiry", () => {
		expect(
			hasHardRevalidation(
				{ revalidatedAt: { N: "1500" }, stale: { N: "1500" }, expire: { N: "1800" } },
				1_000,
				2_000
			)
		).toBe(true);
	});

	it("does not hard-invalidate filesystem records before their expiry", async () => {
		await fsDevTagCache.writeTags([{ tag: "future-swr", stale: 2_000, expire: 3_000 }]);

		expect(await fsDevTagCache.hasBeenRevalidated(["future-swr"], 1_000)).toBe(false);
		expect(await fsDevTagCache.isStale?.(["future-swr"], 1_000)).toBe(true);
	});

	it("hard-invalidates filesystem records after their expiry", async () => {
		await fsDevTagCache.writeTags([{ tag: "expired-swr", stale: 1_500, expire: 1_800 }]);

		expect(await fsDevTagCache.hasBeenRevalidated(["expired-swr"], 1_000)).toBe(true);
	});
});
