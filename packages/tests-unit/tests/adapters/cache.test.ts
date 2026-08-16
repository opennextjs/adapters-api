import Cache from "@opennextjs/core/adapters/cache.js";
import { vi } from "vitest";

const cache = {
	name: "mock",
	get: vi.fn().mockResolvedValue({
		value: {
			type: "route",
			body: "{}",
		},
		lastModified: Date.now(),
	}),
	set: vi.fn(),
	delete: vi.fn(),
	revalidateTags: vi.fn(),
};
globalThis.cache = cache;

globalThis.__openNextAls = {
	getStore: vi.fn().mockReturnValue({
		pendingPromiseRunner: {
			withResolvers: vi.fn().mockReturnValue({
				resolve: vi.fn(),
			}),
		},
	}),
};

declare global {
	var openNextConfig: {
		dangerous: { disableIncrementalCache?: boolean; disableTagCache?: boolean };
	};
	var isNextAfter15: boolean;
}

describe("CacheHandler", () => {
	let instance: Cache;

	vi.useFakeTimers().setSystemTime("2024-01-02T00:00:00Z");
	const getFetchCacheSpy = vi.spyOn(Cache.prototype, "getFetchCache");
	const getIncrementalCache = vi.spyOn(Cache.prototype, "getIncrementalCache");

	beforeEach(() => {
		vi.clearAllMocks();

		instance = new Cache();

		globalThis.openNextConfig = {
			dangerous: {
				disableIncrementalCache: false,
			},
		};
		globalThis.isNextAfter15 = false;
	});

	describe("get", () => {
		it("Should return null for cache miss", async () => {
			cache.get.mockResolvedValueOnce({});

			const result = await instance.get("key");

			expect(result).toBeNull();
		});

		describe("disableIncrementalCache", () => {
			beforeEach(() => {
				globalThis.openNextConfig.dangerous.disableIncrementalCache = true;
			});

			it("Should return null when incremental cache is disabled", async () => {
				const result = await instance.get("key");

				expect(result).toBeNull();
			});

			it("Should not set cache when incremental cache is disabled", async () => {
				await instance.set("key", { kind: "REDIRECT", props: {} });

				expect(cache.set).not.toHaveBeenCalled();
			});

			it("Should not delete cache when incremental cache is disabled", async () => {
				await instance.set("key", undefined);

				expect(cache.delete).not.toHaveBeenCalled();
			});
		});

		describe("fetch cache", () => {
			it("Should retrieve cache from fetch cache when hint is fetch (next14)", async () => {
				await instance.get("key", { kindHint: "fetch" });

				expect(getFetchCacheSpy).toHaveBeenCalled();
			});

			describe("next15", () => {
				it("Should retrieve cache from fetch cache when hint is fetch", async () => {
					await instance.get("key", { kind: "FETCH" });

					expect(getFetchCacheSpy).toHaveBeenCalled();
				});

				it("Should return null when fetch cache entry is not found", async () => {
					cache.get.mockResolvedValueOnce(null);

					const result = await instance.get("key", { kind: "FETCH" });

					expect(getFetchCacheSpy).toHaveBeenCalled();
					expect(result).toBeNull();
				});

				it("Should return null when incremental cache throws", async () => {
					cache.get.mockRejectedValueOnce(new Error("Error retrieving cache"));

					const result = await instance.get("key", { kind: "FETCH" });

					expect(getFetchCacheSpy).toHaveBeenCalled();
					expect(result).toBeNull();
				});
			});
		});

		describe("incremental cache", () => {
			it.each(["app", "pages", undefined])(
				"Should retrieve cache from incremental cache when hint is not fetch: %s",
				async (kindHint) => {
					await instance.get("key", { kindHint: kindHint as any });

					expect(getIncrementalCache).toHaveBeenCalled();
				}
			);

			it("Should return value when cache data type is route", async () => {
				cache.get.mockResolvedValueOnce({
					value: {
						type: "route",
						body: "{}",
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "APP_ROUTE",
						body: Buffer.from("{}"),
					},
					lastModified: Date.now(),
				});
			});

			it("Should return base64 encoded value when cache data type is route and content is binary", async () => {
				cache.get.mockResolvedValueOnce({
					value: {
						type: "route",
						body: Buffer.from("hello").toString("base64"),
						meta: {
							headers: {
								"content-type": "image/png",
							},
						},
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "APP_ROUTE",
						body: Buffer.from("hello"),
						headers: {
							"content-type": "image/png",
						},
					},
					lastModified: Date.now(),
				});
			});

			it("Should return value when cache data type is app", async () => {
				cache.get.mockResolvedValueOnce({
					value: {
						type: "app",
						html: "<html></html>",
						rsc: "rsc",
						meta: {
							status: 200,
						},
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "APP_PAGE",
						html: "<html></html>",
						rscData: Buffer.from("rsc"),
						status: 200,
						headers: undefined,
						postponed: undefined,
						segmentData: new Map(),
					},
					lastModified: Date.now(),
				});
			});

			it("Should return value when cache data type is page", async () => {
				cache.get.mockResolvedValueOnce({
					value: {
						type: "page",
						html: "<html></html>",
						json: {},
						meta: {
							status: 200,
						},
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "pages" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "PAGES",
						html: "<html></html>",
						pageData: {},
						status: 200,
						headers: undefined,
					},
					lastModified: Date.now(),
				});
			});

			it("Should return value when cache data type is app with segmentData and postponed (Next 15+)", async () => {
				globalThis.isNextAfter15 = true;
				cache.get.mockResolvedValueOnce({
					value: {
						type: "app",
						html: "<html></html>",
						rsc: "rsc-data",
						segmentData: {
							segment1: "data1",
							segment2: "data2",
						},
						meta: {
							status: 200,
							headers: { "x-custom": "value" },
							postponed: "postponed-data",
						},
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "APP_PAGE",
						html: "<html></html>",
						rscData: Buffer.from("rsc-data"),
						status: 200,
						headers: { "x-custom": "value" },
						postponed: "postponed-data",
						segmentData: new Map([
							["segment1", Buffer.from("data1")],
							["segment2", Buffer.from("data2")],
						]),
					},
					lastModified: Date.now(),
				});
			});

			it("Should return value when cache data type is redirect", async () => {
				cache.get.mockResolvedValueOnce({
					value: {
						type: "redirect",
					},
					lastModified: Date.now(),
				});

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toEqual({
					value: {
						kind: "REDIRECT",
					},
					lastModified: Date.now(),
				});
			});

			it("Should return null when incremental cache fails", async () => {
				cache.get.mockRejectedValueOnce(new Error("Error"));

				const result = await instance.get("key", { kindHint: "app" });

				expect(getIncrementalCache).toHaveBeenCalled();
				expect(result).toBeNull();
			});
		});
	});

	describe("set", () => {
		it("Should delete cache when data is undefined", async () => {
			await instance.set("key", undefined);

			expect(cache.delete).toHaveBeenCalled();
		});

		it("Should set cache when for ROUTE", async () => {
			await instance.set("key", {
				kind: "ROUTE",
				body: Buffer.from("{}"),
				status: 200,
				headers: {},
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{ type: "route", body: "{}", meta: { status: 200, headers: {} } },
				"cache"
			);
		});

		it("Should set cache when for APP_ROUTE", async () => {
			await instance.set("key", {
				kind: "APP_ROUTE",
				body: Buffer.from("{}"),
				status: 200,
				headers: {
					"content-type": "image/png",
				},
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "route",
					body: Buffer.from("{}").toString("base64"),
					meta: { status: 200, headers: { "content-type": "image/png" } },
				},
				"cache"
			);
		});

		it("Should set cache when for PAGE", async () => {
			await instance.set("key", {
				kind: "PAGE",
				html: "<html></html>",
				pageData: {},
				status: 200,
				headers: {},
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "page",
					html: "<html></html>",
					json: {},
				},
				"cache"
			);
		});

		it("Should set cache when for PAGES", async () => {
			await instance.set("key", {
				kind: "PAGES",
				html: "<html></html>",
				pageData: "rsc",
				status: 200,
				headers: {},
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "app",
					html: "<html></html>",
					rsc: "rsc",
					meta: { status: 200, headers: {} },
				},
				"cache"
			);
		});

		it("Should set cache when for APP_PAGE", async () => {
			await instance.set("key", {
				kind: "APP_PAGE",
				html: "<html></html>",
				rscData: Buffer.from("rsc"),
				status: 200,
				headers: {},
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "app",
					html: "<html></html>",
					rsc: "rsc",
					meta: { status: 200, headers: {} },
				},
				"cache"
			);
		});

		it("Should set cache when for APP_PAGE with segmentData and postponed", async () => {
			const segmentData = new Map([
				["segment1", Buffer.from("data1")],
				["segment2", Buffer.from("data2")],
			]);

			await instance.set("key", {
				kind: "APP_PAGE",
				html: "<html></html>",
				rscData: Buffer.from("rsc"),
				status: 200,
				headers: { "x-custom": "value" },
				segmentData,
				postponed: "postponed-data",
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "app",
					html: "<html></html>",
					rsc: "rsc",
					meta: {
						status: 200,
						headers: { "x-custom": "value" },
						postponed: "postponed-data",
					},
					segmentData: {
						segment1: "data1",
						segment2: "data2",
					},
				},
				"cache"
			);
		});

		it("Should set cache when for FETCH", async () => {
			await instance.set("key", {
				kind: "FETCH",
				data: {
					headers: {},
					body: "{}",
					url: "https://example.com",
					status: 200,
					tags: [],
				},
				revalidate: 60,
			});

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					kind: "FETCH",
					data: {
						headers: {},
						body: "{}",
						url: "https://example.com",
						status: 200,
						tags: [],
					},
					revalidate: 60,
				},
				"fetch"
			);
		});

		it("Should set cache when for REDIRECT", async () => {
			await instance.set("key", { kind: "REDIRECT", props: {} });

			expect(cache.set).toHaveBeenCalledWith(
				"key",
				{
					type: "redirect",
					props: {},
				},
				"cache"
			);
		});

		it("Should not set cache when for IMAGE (not implemented)", async () => {
			await instance.set("key", {
				kind: "IMAGE",
				etag: "etag",
				buffer: Buffer.from("hello"),
				extension: "png",
			});

			expect(cache.set).not.toHaveBeenCalled();
		});

		it("Should not throw when set cache throws", async () => {
			cache.set.mockRejectedValueOnce(new Error("Error"));

			await expect(instance.set("key", { kind: "REDIRECT", props: {} })).resolves.not.toThrow();
		});
	});

	describe("revalidateTag", () => {
		beforeEach(() => {
			globalThis.openNextConfig.dangerous.disableTagCache = false;
			globalThis.openNextConfig.dangerous.disableIncrementalCache = false;
		});

		it("Should do nothing if disableIncrementalCache is true", async () => {
			globalThis.openNextConfig.dangerous.disableIncrementalCache = true;

			await instance.revalidateTag("tag");

			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});

		it("Should do nothing if disableTagCache is true", async () => {
			globalThis.openNextConfig.dangerous.disableTagCache = true;

			await instance.revalidateTag("tag");

			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});

		it("Should call cache.revalidateTags with single tag", async () => {
			await instance.revalidateTag("tag");

			expect(cache.revalidateTags).toHaveBeenCalledWith(["tag"], undefined);
		});

		it("Should call cache.revalidateTags with array of tags", async () => {
			await instance.revalidateTag(["tag1", "tag2"]);

			expect(cache.revalidateTags).toHaveBeenCalledWith(["tag1", "tag2"], undefined);
		});

		it("Should not call cache.revalidateTags when tags array is empty", async () => {
			await instance.revalidateTag([]);

			expect(cache.revalidateTags).not.toHaveBeenCalled();
		});

		it("Should not throw when revalidateTags fails", async () => {
			cache.revalidateTags.mockRejectedValueOnce(new Error("Error"));

			await expect(instance.revalidateTag("tag")).resolves.not.toThrow();
		});
	});
});
