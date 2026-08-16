import { beforeEach, describe, expect, it, vi } from "vitest";

import serviceCache, { BINDING_NAME } from "./service-cache.js";

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
const env: Record<string, unknown> = {};

vi.mock("../../cloudflare-context.js", () => ({
	getCloudflareContext: () => ({ env }),
}));

function lastRequest() {
	const [url, init] = fetchMock.mock.calls.at(-1)!;
	return { url: new URL(url), method: init?.method ?? "GET", body: init?.body };
}

describe("serviceCache", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(new Response("", { headers: { "x-opennext-cache-found": "false" } }));
		env[BINDING_NAME] = { fetch: fetchMock };
	});

	it("throws when the service is not bound", async () => {
		delete env[BINDING_NAME];

		await expect(serviceCache.get("key")).rejects.toThrow(BINDING_NAME);
	});

	describe("get", () => {
		it("requests the key, the cache type and the additional tags", async () => {
			await serviceCache.get("key/with/slashes", "fetch", ["tag1", "tag2"]);

			const { url, method } = lastRequest();
			expect(method).toBe("GET");
			expect(url.pathname).toBe(`/cache/${encodeURIComponent("key/with/slashes")}`);
			expect(url.searchParams.get("type")).toBe("fetch");
			expect(url.searchParams.get("tags")).toBe("tag1,tag2");
		});

		it("omits the tags when there is none", async () => {
			await serviceCache.get("key", "cache", []);

			expect(lastRequest().url.searchParams.has("tags")).toBe(false);
		});

		it("returns null on a cache miss", async () => {
			await expect(serviceCache.get("key")).resolves.toBeNull();
		});

		it("parses a cache hit", async () => {
			fetchMock.mockResolvedValue(
				new Response("body", {
					headers: {
						"x-opennext-cache-found": "true",
						"x-opennext-cache-type": "cache",
						"x-opennext-cache-sub-type": "route",
						"x-opennext-cache-last-modified": "1234",
					},
				})
			);

			await expect(serviceCache.get("key")).resolves.toEqual({
				lastModified: 1234,
				value: expect.objectContaining({ type: "route", body: "body" }),
			});
		});
	});

	describe("set", () => {
		// The cache type is part of the key for the incremental caches, it has to be forwarded
		// or entries would be written where they are not read from.
		it("sends the value and the cache type", async () => {
			await serviceCache.set("key", { kind: "FETCH", data: { headers: {}, body: "b", url: "u" } }, "fetch");

			const { url, method, body } = lastRequest();
			expect(method).toBe("PUT");
			expect(url.pathname).toBe("/cache/key");
			expect(url.searchParams.get("type")).toBe("fetch");
			expect(JSON.parse(body as string)).toEqual({
				value: { kind: "FETCH", data: { headers: {}, body: "b", url: "u" } },
			});
		});
	});

	it("deletes a key", async () => {
		await serviceCache.delete("key");

		const { url, method } = lastRequest();
		expect(method).toBe("DELETE");
		expect(url.pathname).toBe("/cache/key");
	});

	it("revalidates tags", async () => {
		await serviceCache.revalidateTags(["tag1", "tag2"]);

		const { url, method, body } = lastRequest();
		expect(method).toBe("POST");
		expect(url.pathname).toBe("/cache/revalidate-tags");
		expect(JSON.parse(body as string)).toEqual({ tags: ["tag1", "tag2"] });
	});
});
