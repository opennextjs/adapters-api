import { RequestCache } from "@opennextjs/aws/utils/requestCache.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/aws/adapters/logger.js", () => ({
	awsLogger: {},
	debug: vi.fn(),
	error: vi.fn(),
}));

const mockSend = vi.hoisted(() => {
	process.env.NEXT_BUILD_ID = "test-build-id";
	process.env.CACHE_DYNAMO_TABLE = "test-table";
	process.env.CACHE_BUCKET_REGION = "us-east-1";
	return vi.fn();
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
	DynamoDBClient: vi.fn().mockReturnValue({ send: mockSend }),
	QueryCommand: vi.fn().mockImplementation((params: any) => params),
	BatchWriteItemCommand: vi.fn().mockImplementation((params: any) => params),
}));

// oxlint-disable-next-line eslint-plugin-import(first)
import tagCache from "@opennextjs/aws/overrides/tagCache/dynamodb.js";

declare global {
	//@ts-ignore
	var openNextConfig: { dangerous?: { disableTagCache?: boolean } };
	//@ts-ignore
	var __openNextAls: { getStore: () => any };
}

const BUILD_ID = "test-build-id";
const TABLE_NAME = "test-table";

function makeStore() {
	return { requestCache: new RequestCache() };
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NEXT_BUILD_ID = BUILD_ID;
	process.env.CACHE_DYNAMO_TABLE = TABLE_NAME;
	process.env.CACHE_BUCKET_REGION = "us-east-1";
	globalThis.openNextConfig = { dangerous: { disableTagCache: false } };
	globalThis.__openNextAls = {
		getStore: vi.fn().mockReturnValue(makeStore()),
	};
});

describe("dynamodb tagCache", () => {
	describe("getByPath", () => {
		it("returns tags with buildId prefix stripped", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ tag: { S: BUILD_ID + "/tag1" } }, { tag: { S: BUILD_ID + "/tag2" } }],
			});

			const result = await tagCache.getByPath("/some/path");

			expect(result).toEqual(["tag1", "tag2"]);
		});

		it("queries DynamoDB with the correct key", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			await tagCache.getByPath("/some/path");

			const sentCommand = mockSend.mock.calls[0][0];
			expect(sentCommand.ExpressionAttributeValues[":key"]).toEqual({
				S: BUILD_ID + "/some/path",
			});
		});

		it("returns [] when disableTagCache is true", async () => {
			globalThis.openNextConfig = { dangerous: { disableTagCache: true } };

			const result = await tagCache.getByPath("/some/path");

			expect(mockSend).not.toHaveBeenCalled();
			expect(result).toEqual([]);
		});

		it("returns cached result on second call without re-querying DynamoDB", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ tag: { S: BUILD_ID + "/tag1" } }],
			});

			await tagCache.getByPath("/some/path");
			const result = await tagCache.getByPath("/some/path");

			expect(mockSend).toHaveBeenCalledTimes(1);
			expect(result).toEqual(["tag1"]);
		});

		it("returns [] on DynamoDB error", async () => {
			mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

			const result = await tagCache.getByPath("/some/path");

			expect(result).toEqual([]);
		});

		it("returns empty array when Items is undefined", async () => {
			mockSend.mockResolvedValueOnce({ Items: undefined });

			const result = await tagCache.getByPath("/some/path");

			expect(result).toEqual([]);
		});
	});

	describe("getByTag", () => {
		it("returns paths with buildId prefix stripped", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ path: { S: BUILD_ID + "/path1" } }, { path: { S: BUILD_ID + "/path2" } }],
			});

			const result = await tagCache.getByTag("my-tag");

			expect(result).toEqual(["path1", "path2"]);
		});

		it("queries DynamoDB with the correct tag key", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			await tagCache.getByTag("my-tag");

			const sentCommand = mockSend.mock.calls[0][0];
			expect(sentCommand.ExpressionAttributeValues[":tag"]).toEqual({
				S: BUILD_ID + "/my-tag",
			});
		});

		it("returns [] when disableTagCache is true", async () => {
			globalThis.openNextConfig = { dangerous: { disableTagCache: true } };

			const result = await tagCache.getByTag("my-tag");

			expect(mockSend).not.toHaveBeenCalled();
			expect(result).toEqual([]);
		});

		it("returns cached result on second call without re-querying DynamoDB", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ path: { S: BUILD_ID + "/path1" } }],
			});

			await tagCache.getByTag("some-tag");
			const result = await tagCache.getByTag("some-tag");

			expect(mockSend).toHaveBeenCalledTimes(1);
			expect(result).toEqual(["path1"]);
		});

		it("returns [] on DynamoDB error", async () => {
			mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

			const result = await tagCache.getByTag("my-tag");

			expect(result).toEqual([]);
		});
	});

	describe("getLastModified", () => {
		it("returns lastModified when no revalidated tags exist", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			const result = await tagCache.getLastModified("/key", 12345);

			expect(result).toBe(12345);
		});

		it("returns -1 when revalidated tags exist", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ revalidatedAt: { N: "99999" }, tag: { S: BUILD_ID + "/t" } }],
			});

			const result = await tagCache.getLastModified("/key", 12345);

			expect(result).toBe(-1);
		});

		it("returns -1 when an expired tag falls between lastModified and now", async () => {
			const now = Date.now();
			const expiry = now - 1000;
			const lastModified = now - 2000;

			mockSend.mockResolvedValueOnce({
				Items: [
					{
						revalidatedAt: { N: String(expiry) },
						expire: { N: String(expiry) },
						tag: { S: BUILD_ID + "/t" },
					},
				],
			});

			const result = await tagCache.getLastModified("/key", lastModified);

			expect(result).toBe(-1);
		});

		it("ignores a still-active expiry tag in the revalidated-tag count", async () => {
			const now = Date.now();
			const expiry = now + 60_000;

			mockSend.mockResolvedValueOnce({
				Items: [
					{
						revalidatedAt: { N: String(now - 5000) },
						expire: { N: String(expiry) },
						tag: { S: BUILD_ID + "/t" },
					},
				],
			});

			const result = await tagCache.getLastModified("/key", now - 10_000);

			expect(result).toBe(-1);
		});

		it("returns lastModified when disableTagCache is true", async () => {
			globalThis.openNextConfig = { dangerous: { disableTagCache: true } };

			const result = await tagCache.getLastModified("/key", 12345);

			expect(mockSend).not.toHaveBeenCalled();
			expect(result).toBe(12345);
		});

		it("uses cached items when called twice with the same key and lastModified", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			await tagCache.getLastModified("/key", 100);
			await tagCache.getLastModified("/key", 100);

			expect(mockSend).toHaveBeenCalledTimes(1);
		});

		it("returns lastModified on DynamoDB error", async () => {
			mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

			const result = await tagCache.getLastModified("/key", 12345);

			expect(result).toBe(12345);
		});

		it("returns Date.now() when lastModified is undefined and no tags", async () => {
			vi.useFakeTimers().setSystemTime(50000);
			mockSend.mockResolvedValueOnce({ Items: [] });

			const result = await tagCache.getLastModified("/key", undefined);

			expect(result).toBe(50000);
			vi.useRealTimers();
		});
	});

	describe("isStale", () => {
		it("returns true when items exist beyond lastModified", async () => {
			mockSend.mockResolvedValueOnce({
				Items: [{ revalidatedAt: { N: "99999" } }],
			});

			const result = await tagCache.isStale("/key", 12345);

			expect(result).toBe(true);
		});

		it("returns false when no items exist", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			const result = await tagCache.isStale("/key", 12345);

			expect(result).toBe(false);
		});

		it("returns false when disableTagCache is true", async () => {
			globalThis.openNextConfig = { dangerous: { disableTagCache: true } };

			const result = await tagCache.isStale("/key", 12345);

			expect(mockSend).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it("shares cached items with getLastModified for the same key+lastModified", async () => {
			mockSend.mockResolvedValueOnce({ Items: [] });

			await tagCache.getLastModified("/key", 100);
			const result = await tagCache.isStale("/key", 100);

			expect(mockSend).toHaveBeenCalledTimes(1);
			expect(result).toBe(false);
		});

		it("returns false on DynamoDB error", async () => {
			mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

			const result = await tagCache.isStale("/key", 12345);

			expect(result).toBe(false);
		});
	});
});
