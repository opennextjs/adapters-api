import ComposableCache from "@opennextjs/core/adapters/composable-cache";
import { fromReadableStream, toReadableStream } from "@opennextjs/core/utils/stream";
import { vi } from "vitest";

const cache = {
	name: "mock",
	get: vi.fn().mockResolvedValue({
		value: {
			type: "route",
			body: "{}",
			tags: ["tag1", "tag2"],
			stale: 0,
			timestamp: Date.now(),
			expire: Date.now() + 1000,
			revalidate: 3600,
			value: "test-value",
		},
		lastModified: Date.now(),
	}),
	set: vi.fn(),
	delete: vi.fn(),
	revalidateTags: vi.fn(),
};
globalThis.cache = cache;

globalThis.__openNextAls = {
	getStore: () => ({
		pendingPromiseRunner: {
			withResolvers: vi.fn().mockReturnValue({
				resolve: vi.fn(),
			}),
		},
		writtenTags: new Set(),
	}),
};

describe("Composable cache handler", () => {
	vi.useFakeTimers().setSystemTime("2024-01-02T00:00:00Z");

	beforeEach(() => {
		vi.clearAllMocks();

		globalThis.openNextConfig = {
			dangerous: {
				disableIncrementalCache: false,
				disableTagCache: false,
			},
		};
	});

	describe("get", () => {
		it("should return cached entry when available", async () => {
			const result = await ComposableCache.get("test-key");

			expect(cache.get).toHaveBeenCalledWith("test-key", "composable");
			expect(result).toBeDefined();
			expect(result?.tags).toEqual(["tag1", "tag2"]);
			expect(result?.value).toBeInstanceOf(ReadableStream);
		});

		it("should return undefined when cache entry does not exist", async () => {
			cache.get.mockResolvedValueOnce(null);

			const result = await ComposableCache.get("non-existent-key");

			expect(result).toBeUndefined();
		});

		it("should return undefined when cache entry has no value", async () => {
			cache.get.mockResolvedValueOnce({
				value: null,
				lastModified: Date.now(),
			});

			const result = await ComposableCache.get("test-key");

			expect(result).toBeUndefined();
		});

		it("should return undefined on cache read error", async () => {
			cache.get.mockRejectedValueOnce(new Error("Cache error"));

			const result = await ComposableCache.get("test-key");

			expect(result).toBeUndefined();
		});

		it("should return pending write promise if available", async () => {
			const pendingEntry = Promise.resolve({
				value: toReadableStream("pending-value"),
				tags: ["tag1"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			});

			// Start a set operation to create a pending write
			const setPromise = ComposableCache.set("pending-key", pendingEntry);

			// Try to get the same key while set is in progress
			const result = await ComposableCache.get("pending-key");

			expect(result).toBeDefined();
			expect(result?.value).toBeInstanceOf(ReadableStream);

			// Wait for set to complete
			await setPromise;
		});
	});

	describe("set", () => {
		it("should set cache entry", async () => {
			const entry = {
				value: toReadableStream("test-value"),
				tags: ["tag1", "tag2"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			};

			await ComposableCache.set("test-key", Promise.resolve(entry));

			expect(cache.set).toHaveBeenCalledWith(
				"test-key",
				expect.objectContaining({
					tags: ["tag1", "tag2"],
					value: "test-value",
				}),
				"composable"
			);
		});

		it("should convert ReadableStream to string", async () => {
			const entry = {
				value: toReadableStream("test-content"),
				tags: ["tag1"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			};

			await ComposableCache.set("test-key", Promise.resolve(entry));

			expect(cache.set).toHaveBeenCalledWith(
				"test-key",
				expect.objectContaining({
					value: "test-content",
				}),
				"composable"
			);
		});
	});

	describe("refreshTags", () => {
		it("should do nothing", async () => {
			await ComposableCache.refreshTags();

			// Should not call any methods
			expect(cache.get).not.toHaveBeenCalled();
			expect(cache.set).not.toHaveBeenCalled();
			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});
	});

	describe("getExpiration", () => {
		it("should return 0 regardless of arguments", async () => {
			const result = await ComposableCache.getExpiration("tag1", "tag2");

			expect(result).toBe(0);
		});

		it("should return 0 for array argument (Next 16 signature)", async () => {
			const result = await ComposableCache.getExpiration(["tag1", "tag2"]);

			expect(result).toBe(0);
		});

		it("should return 0 for empty args", async () => {
			const result = await ComposableCache.getExpiration();

			expect(result).toBe(0);
		});
	});

	describe("expireTags", () => {
		it("should call cache.revalidateTags with flat tags array", async () => {
			await ComposableCache.expireTags("tag1", "tag2");

			expect(cache.revalidateTags).toHaveBeenCalledWith(["tag1", "tag2"]);
		});

		it("should not call revalidateTags when no tags provided", async () => {
			await ComposableCache.expireTags();

			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});
	});

	describe("receiveExpiredTags", () => {
		it("should do nothing", async () => {
			await ComposableCache.receiveExpiredTags("tag1", "tag2");

			// Should not call any methods
			expect(cache.get).not.toHaveBeenCalled();
			expect(cache.set).not.toHaveBeenCalled();
			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});
	});

	describe("integration tests", () => {
		it("should handle complete cache lifecycle", async () => {
			// Set a cache entry
			const entry = {
				value: toReadableStream("integration-test"),
				tags: ["integration-tag"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			};

			await ComposableCache.set("integration-key", Promise.resolve(entry));

			// Verify it was stored
			expect(cache.set).toHaveBeenCalledWith(
				"integration-key",
				expect.objectContaining({
					value: "integration-test",
					tags: ["integration-tag"],
				}),
				"composable"
			);

			// Mock the get response
			cache.get.mockResolvedValueOnce({
				value: {
					...entry,
					value: "integration-test",
				},
				lastModified: Date.now(),
			});

			// Get the cache entry
			const result = await ComposableCache.get("integration-key");

			expect(result).toBeDefined();
			expect(result?.tags).toEqual(["integration-tag"]);

			// Convert the stream back to verify content
			const content = await fromReadableStream(result!.value);
			expect(content).toBe("integration-test");
		});

		it("should handle concurrent get/set operations", async () => {
			const entry1 = {
				value: toReadableStream("concurrent-1"),
				tags: ["tag1"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			};

			const entry2 = {
				value: toReadableStream("concurrent-2"),
				tags: ["tag2"],
				stale: 0,
				timestamp: Date.now(),
				expire: Date.now() + 1000,
				revalidate: 3600,
			};

			// Start multiple operations concurrently
			const promises = [
				ComposableCache.set("key1", Promise.resolve(entry1)),
				ComposableCache.set("key2", Promise.resolve(entry2)),
				ComposableCache.get("key1"),
				ComposableCache.get("key2"),
			];

			const results = await Promise.all(promises);

			expect(cache.set).toHaveBeenCalledTimes(2);
			expect(cache.get).not.toHaveBeenCalled();

			expect(results[2]).toBeDefined();
			expect(results[3]).toBeDefined();

			const content1 = await fromReadableStream(results[2]!.value);
			expect(content1).toBe("concurrent-1");

			const content2 = await fromReadableStream(results[3]!.value);
			expect(content2).toBe("concurrent-2");
		});
	});
});
