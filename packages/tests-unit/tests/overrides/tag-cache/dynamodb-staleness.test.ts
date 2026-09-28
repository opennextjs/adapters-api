import { AsyncLocalStorage } from "node:async_hooks";

import lite from "@opennextjs/aws/overrides/tagCache/dynamodb-lite.js";
import full from "@opennextjs/aws/overrides/tagCache/dynamodb.js";
import { runWithOpenNextRequestContext } from "@opennextjs/core/utils/promise.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send, fetchDynamo } = vi.hoisted(() => ({ send: vi.fn(), fetchDynamo: vi.fn() }));
vi.mock("../../../../aws/node_modules/@aws-sdk/client-dynamodb", () => ({
	DynamoDBClient: class {
		send = send;
	},
	QueryCommand: class {
		constructor(public input: unknown) {}
	},
	BatchWriteItemCommand: class {},
}));
vi.mock("@opennextjs/aws/utils/fetch.js", () => ({ customFetchClient: () => fetchDynamo }));

describe.each([
	["full", full, send],
	["lite", lite, fetchDynamo],
] as const)("%s DynamoDB stale reads", (_name, cache, query) => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("AWS_ACCESS_KEY_ID", "test");
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test");
		vi.useFakeTimers().setSystemTime(2_000);
		globalThis.openNextConfig = { dangerous: {} } as never;
		globalThis.__openNextAls = new AsyncLocalStorage();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it.each([
		["legacy hard invalidation", { revalidatedAt: { N: "1600" } }, false],
		["active SWR", { revalidatedAt: { N: "1600" }, stale: { N: "1600" }, expire: { N: "3000" } }, true],
		["indefinite SWR", { revalidatedAt: { N: "1600" }, stale: { N: "1600" } }, true],
		[
			"stale event predates entry",
			{ revalidatedAt: { N: "1600" }, stale: { N: "1000" }, expire: { N: "3000" } },
			false,
		],
		[
			"superseded expiry",
			{ revalidatedAt: { N: "1600" }, stale: { N: "1000" }, expire: { N: "1200" } },
			false,
		],
		["expired window", { revalidatedAt: { N: "1600" }, stale: { N: "1600" }, expire: { N: "1800" } }, false],
		["older revalidation", { revalidatedAt: { N: "1000" }, stale: { N: "1600" } }, false],
		["equal stale timestamp", { revalidatedAt: { N: "1600" }, stale: { N: "1500" } }, false],
	])("classifies %s and shares the hard-check query", async (_case, item, expected) => {
		send.mockResolvedValue({ Items: [item] });
		fetchDynamo.mockImplementation(async () => new Response(JSON.stringify({ Items: [item] })));
		await runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			await cache.getLastModified("page", 1500);
			expect(await cache.isStale!("page", 1500)).toBe(expected);
			expect(query).toHaveBeenCalledTimes(1);
		});
	});
});
