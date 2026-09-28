import { AsyncLocalStorage } from "node:async_hooks";

import cache from "@opennextjs/aws/overrides/tagCache/dynamodb-nextMode.js";
import { runWithOpenNextRequestContext } from "@opennextjs/core/utils/promise.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchDynamo } = vi.hoisted(() => ({ fetchDynamo: vi.fn() }));
vi.mock("@opennextjs/aws/utils/fetch.js", () => ({ customFetchClient: () => fetchDynamo }));

describe("next-mode partial DynamoDB batches", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.useFakeTimers().setSystemTime(2000);
		vi.stubEnv("AWS_ACCESS_KEY_ID", "test");
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test");
		vi.stubEnv("CACHE_DYNAMO_TABLE", "tags");
		vi.stubEnv("NEXT_BUILD_ID", "");
		globalThis.openNextConfig = { dangerous: {} } as never;
		globalThis.__openNextAls = new AsyncLocalStorage();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it("retries only unprocessed keys and shares processed hits and misses", async () => {
		const retried = {
			tag: { S: "_tag/retry" },
			revalidatedAt: { N: "1500" },
			stale: { N: "1500" },
			expire: { N: "3000" },
		};
		fetchDynamo
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						Responses: { tags: [{ tag: { S: "_tag/fresh" }, revalidatedAt: { N: "500" } }] },
						UnprocessedKeys: { tags: { Keys: [{ tag: { S: "_tag/retry" }, path: { S: "_tag/retry" } }] } },
					})
				)
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ Responses: { tags: [retried] } })));
		const pending = runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			expect(await cache.hasBeenRevalidated(["fresh", "missing", "retry"], 1000)).toBe(false);
			expect(await cache.isStale(["fresh", "missing", "retry"], 1000)).toBe(true);
			const records = globalThis.__openNextAls.getStore()!.requestCache.getOrCreate("ddb-nextMode:tagItems");
			expect(records.get("missing")).toBeNull();
			expect(records.get("retry")).toEqual(retried);
		});
		await vi.runAllTimersAsync();
		await pending;
		expect(fetchDynamo).toHaveBeenCalledTimes(2);
		expect(JSON.parse(fetchDynamo.mock.calls[1][1].body).RequestItems.tags.Keys).toEqual([
			{ path: { S: "_tag/retry" }, tag: { S: "_tag/retry" } },
		]);
	});

	it("fails bounded retries without negative-caching unread tags", async () => {
		fetchDynamo.mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						UnprocessedKeys: { tags: { Keys: [{ tag: { S: "_tag/retry" } }] } },
					})
				)
		);
		const pending = runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			await expect(cache.hasBeenRevalidated(["retry"], 1000)).rejects.toThrow("after three retries");
			expect(
				globalThis.__openNextAls.getStore()!.requestCache.getOrCreate("ddb-nextMode:tagItems").has("retry")
			).toBe(false);
		});
		await vi.runAllTimersAsync();
		await pending;
		expect(fetchDynamo).toHaveBeenCalledTimes(4);
	});
});
