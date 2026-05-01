import fetchCache from "@opennextjs/core/overrides/cache/fetch";
import { vi, describe, expect, it, beforeEach, afterEach } from "vitest";

// Helper: convert a plain headers object to a Map (mimics Headers API)
function toHeadersMap(headers: Record<string, string>): Map<string, string> {
	const map = new Map<string, string>();
	for (const [key, value] of Object.entries(headers)) {
		map.set(key, value);
	}
	return map;
}

function mockFetch(resp: { headers: Record<string, string>; body: string; status?: number }) {
	const response = {
		ok: true,
		status: resp.status ?? 200,
		text: vi.fn().mockResolvedValue(resp.body),
		headers: toHeadersMap(resp.headers),
	};
	global.fetch = vi.fn().mockResolvedValue(response);
}

describe("fetch cache", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should have name 'fetch-cache'", () => {
		expect(fetchCache.name).toBe("fetch-cache");
	});

	describe("get", () => {
		it("should make a GET request to the correct URL", async () => {
			mockFetch({ headers: {} as Record<string, string>, body: "" });

			await fetchCache.get("my-key");

			expect(global.fetch).toHaveBeenCalledWith("/cache/my-key", { method: "GET" });
		});

		it("should encode the key in the URL", async () => {
			mockFetch({ headers: {} as Record<string, string>, body: "" });

			await fetchCache.get("special/key");

			expect(global.fetch).toHaveBeenCalledWith("/cache/special%2Fkey", { method: "GET" });
		});

		it("should add type query param when cacheType is provided", async () => {
			mockFetch({ headers: {} as Record<string, string>, body: "" });

			await fetchCache.get("key", "fetch");

			expect(global.fetch).toHaveBeenCalledWith("/cache/key?type=fetch", { method: "GET" });
		});

		it("should return null when x-opennext-cache-found is not true", async () => {
			// No x-opennext-cache-found header → parseCacheGetResponse returns null
			mockFetch({ headers: { "content-type": "text/plain" }, body: "" });

			const result = await fetchCache.get("key");

			expect(result).toBeNull();
		});

		it("should return null for cache miss (found = false)", async () => {
			mockFetch({
				headers: {
					"x-opennext-cache-found": "false",
					"x-opennext-cache-type": "cache",
					"Cache-Control": "no-store",
				},
				body: "",
			});

			const result = await fetchCache.get("key");

			expect(result).toBeNull();
		});

		it("should reconstruct a route cache entry from the response", async () => {
			mockFetch({
				headers: {
					"x-opennext-cache-found": "true",
					"x-opennext-cache-type": "cache",
					"x-opennext-cache-sub-type": "route",
					"x-opennext-cache-last-modified": "1000",
					"Cache-Control": "no-store",
				},
				body: "route-body-content",
			});

			const result = await fetchCache.get("key");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "route",
				body: "route-body-content",
			});
			expect(result!.lastModified).toBe(1000);
		});

		it("should reconstruct a fetch cache entry from the response", async () => {
			mockFetch({
				headers: {
					"x-opennext-cache-found": "true",
					"x-opennext-cache-type": "fetch",
					"x-opennext-cache-fetch-kind": "FETCH",
					"x-opennext-cache-fetch-data-url": "https://example.com",
					"x-opennext-cache-fetch-data-status": "200",
					"Cache-Control": "no-store",
				},
				body: '{"data":"value"}',
			});

			const result = await fetchCache.get("key");

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

		it("should pass response headers (as plain object) and body text to parseCacheGetResponse", async () => {
			mockFetch({
				headers: {
					"x-opennext-cache-found": "true",
					"x-opennext-cache-type": "cache",
					"x-opennext-cache-sub-type": "route",
					"Content-Type": "text/plain",
				},
				body: "hello",
			});

			const result = await fetchCache.get("key");

			// parseCacheGetResponse receives the headers as a plain Record<string, string>
			// and the body text, then returns the parsed result
			expect(result).not.toBeNull();
			expect(result!.value).toMatchObject({ type: "route", body: "hello" });
		});
	});

	describe("set", () => {
		it("should make a PUT request with JSON body", async () => {
			const value = { type: "route", body: "content" };
			await fetchCache.set("key", value);

			expect(global.fetch).toHaveBeenCalledWith("/cache/key", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ value }),
			});
		});

		it("should encode the key in the URL", async () => {
			await fetchCache.set("special/key", {});

			expect(global.fetch).toHaveBeenCalledWith("/cache/special%2Fkey", expect.any(Object));
		});
	});

	describe("delete", () => {
		it("should make a DELETE request", async () => {
			await fetchCache.delete("key");

			expect(global.fetch).toHaveBeenCalledWith("/cache/key", { method: "DELETE" });
		});
	});

	describe("revalidateTags", () => {
		it("should make a POST request with tags body", async () => {
			await fetchCache.revalidateTags(["tag1", "tag2"]);

			expect(global.fetch).toHaveBeenCalledWith("/cache/revalidate-tags", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tags: ["tag1", "tag2"] }),
			});
		});
	});
});
