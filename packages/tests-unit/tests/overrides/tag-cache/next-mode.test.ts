import fsDevTagCache from "@opennextjs/core/overrides/tagCache/fs-dev-nextMode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	cacheDynamoItems,
	hasHardRevalidation,
} from "../../../../aws/src/overrides/tagCache/dynamodb-nextMode.js";
import type { DynamoDBItem } from "../../../../aws/src/overrides/tagCache/dynamodb-nextMode.js";

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

	it("keeps DynamoDB records stale when their SWR window has no expiry", () => {
		expect(hasHardRevalidation({ revalidatedAt: { N: "1500" }, stale: { N: "1500" } }, 1_000, 2_000)).toBe(
			false
		);
	});

	it("caches missing DynamoDB tags for the duration of the request", () => {
		const itemsCache = new Map<string, DynamoDBItem | null>();

		const hasMatch = cacheDynamoItems(["missing-tag"], [], itemsCache, () => true);

		expect(hasMatch).toBe(false);
		expect(itemsCache.has("missing-tag")).toBe(true);
		expect(itemsCache.get("missing-tag")).toBeNull();
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

	it("keeps filesystem records stale when their SWR window has no expiry", async () => {
		await fsDevTagCache.writeTags([{ tag: "indefinite-swr", stale: 2_000 }]);

		expect(await fsDevTagCache.hasBeenRevalidated(["indefinite-swr"], 1_000)).toBe(false);
		expect(await fsDevTagCache.isStale?.(["indefinite-swr"], 1_000)).toBe(true);
	});
});
