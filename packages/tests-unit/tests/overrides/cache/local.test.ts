import localCache from "@opennextjs/core/overrides/cache/local";
import type { InternalResult } from "@opennextjs/core/types/open-next";
import { toReadableStream } from "@opennextjs/core/utils/stream";
import { vi, describe, expect, it, beforeEach } from "vitest";

vi.mock("@opennextjs/core/utils/normalize-path", () => ({
	getMonorepoRelativePath: vi.fn().mockReturnValue("/mock/root"),
}));

const mockHandler = vi.fn();

vi.mock("/mock/root/cache-function/index.mjs", () => ({
	handler: mockHandler,
}));

function createMockResult(overrides: Partial<InternalResult> & { bodyText?: string } = {}): InternalResult {
	const { bodyText, ...rest } = overrides;
	return {
		type: "core",
		statusCode: 200,
		body: toReadableStream(bodyText ?? ""),
		isBase64Encoded: false,
		headers: {},
		...rest,
	};
}

describe("local cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have name 'local-cache'", () => {
		expect(localCache.name).toBe("local-cache");
	});

	describe("get", () => {
		it("should construct a GET InternalEvent with the correct rawPath", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({ bodyText: "", headers: {} as Record<string, string> })
			);

			await localCache.get("my-key");

			const event = mockHandler.mock.calls[0][0];
			expect(event.method).toBe("GET");
			expect(event.rawPath).toBe("/cache/my-key");
			expect(event.url).toBe("https://on/cache/my-key");
		});

		it("should encode the key in rawPath and url", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({ bodyText: "", headers: {} as Record<string, string> })
			);

			await localCache.get("special/key");

			const event = mockHandler.mock.calls[0][0];
			expect(event.rawPath).toBe("/cache/special%2Fkey");
			expect(event.url).toBe("https://on/cache/special%2Fkey");
		});

		it("should add type query param when cacheType is provided", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({ bodyText: "", headers: {} as Record<string, string> })
			);

			await localCache.get("key", "fetch");

			const event = mockHandler.mock.calls[0][0];
			expect(event.query).toEqual({ type: "fetch" });
		});

		it("should return null when x-opennext-cache-found is missing", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({ bodyText: "", headers: { "content-type": "text/plain" } })
			);

			const result = await localCache.get("key");

			expect(result).toBeNull();
		});

		it("should return null for cache miss (found = false)", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({
					bodyText: "",
					headers: { "x-opennext-cache-found": "false", "Cache-Control": "no-store" },
				})
			);

			const result = await localCache.get("key");

			expect(result).toBeNull();
		});

		it("should reconstruct a route cache entry from handler result", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({
					bodyText: "route-body",
					headers: {
						"x-opennext-cache-found": "true",
						"x-opennext-cache-type": "cache",
						"x-opennext-cache-sub-type": "route",
						"x-opennext-cache-last-modified": "1000",
						"Cache-Control": "no-store",
						"Content-Type": "text/plain",
					},
				})
			);

			const result = await localCache.get("key");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({ type: "route", body: "route-body" });
			expect(result!.lastModified).toBe(1000);
		});

		it("should reconstruct a fetch cache entry from handler result", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({
					bodyText: '{"data":"value"}',
					headers: {
						"x-opennext-cache-found": "true",
						"x-opennext-cache-type": "fetch",
						"x-opennext-cache-fetch-kind": "FETCH",
						"x-opennext-cache-fetch-data-url": "https://example.com",
						"x-opennext-cache-fetch-data-status": "200",
						"Cache-Control": "no-store",
					},
				})
			);

			const result = await localCache.get("key");

			expect(result).not.toBeNull();
			expect(result!.value).toMatchObject({
				kind: "FETCH",
				data: {
					url: "https://example.com",
					status: 200,
					body: '{"data":"value"}',
				},
			});
		});
	});

	describe("set", () => {
		it("should construct a PUT InternalEvent with JSON body", async () => {
			mockHandler.mockResolvedValue(createMockResult());
			const value = { type: "route", body: "content" };

			await localCache.set("key", value);

			const event = mockHandler.mock.calls[0][0];
			expect(event.method).toBe("PUT");
			expect(event.rawPath).toBe("/cache/key");
			expect(event.headers).toEqual({ "Content-Type": "application/json" });
			expect(event.body).toEqual(Buffer.from(JSON.stringify({ value })));
		});

		it("should encode the key", async () => {
			mockHandler.mockResolvedValue(createMockResult());

			await localCache.set("special/key", {});

			const event = mockHandler.mock.calls[0][0];
			expect(event.rawPath).toBe("/cache/special%2Fkey");
		});

		// Incremental caches may key entries on the cache type, writing without it would store
		// the entry where `get` does not look for it.
		it("should forward the cache type", async () => {
			mockHandler.mockResolvedValue(createMockResult());

			await localCache.set("key", {}, "composable");

			const event = mockHandler.mock.calls[0][0];
			expect(event.query).toEqual({ type: "composable" });
		});
	});

	describe("delete", () => {
		it("should construct a DELETE InternalEvent", async () => {
			mockHandler.mockResolvedValue(createMockResult());

			await localCache.delete("key");

			const event = mockHandler.mock.calls[0][0];
			expect(event.method).toBe("DELETE");
			expect(event.rawPath).toBe("/cache/key");
		});
	});

	describe("revalidateTags", () => {
		it("should construct a POST InternalEvent with tags body", async () => {
			mockHandler.mockResolvedValue(createMockResult());

			await localCache.revalidateTags(["tag1", "tag2"]);

			const event = mockHandler.mock.calls[0][0];
			expect(event.method).toBe("POST");
			expect(event.rawPath).toBe("/cache/revalidate-tags");
			expect(event.body).toEqual(Buffer.from(JSON.stringify({ tags: ["tag1", "tag2"] })));
		});
	});

	describe("handler caching", () => {
		it("should reuse the handler across multiple calls", async () => {
			mockHandler.mockResolvedValue(
				createMockResult({ bodyText: "", headers: {} as Record<string, string> })
			);

			await localCache.get("key1");
			await localCache.get("key2");

			expect(mockHandler).toHaveBeenCalledTimes(2);
		});
	});
});
