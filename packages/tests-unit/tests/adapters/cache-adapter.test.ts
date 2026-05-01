import { AsyncLocalStorage } from "node:async_hooks";

import { handler } from "@opennextjs/core/adapters/cache-adapter";
import type { InternalEvent, InternalResult, OpenNextConfig } from "@opennextjs/core/types/open-next";
import { fromReadableStream } from "@opennextjs/core/utils/stream";
import { type Mock, vi, describe, expect, it, beforeEach } from "vitest";

const mockResolveIncrementalCache = vi.hoisted(() => vi.fn());
const mockResolveTagCache = vi.hoisted(() => vi.fn());
const mockResolveCdnInvalidation = vi.hoisted(() => vi.fn());

const mockIncrementalCache = vi.hoisted(() => ({
	name: "mock",
	get: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
}));

const mockTagCache = vi.hoisted(() => ({
	name: "mock",
	mode: "original",
	getByTag: vi.fn(),
	getByPath: vi.fn(),
	getLastModified: vi.fn(),
	writeTags: vi.fn(),
	hasBeenRevalidated: vi.fn(),
	getPathsByTags: undefined as Mock | undefined,
}));

const mockCdnInvalidationHandler = vi.hoisted(() => ({
	name: "mock",
	invalidatePaths: vi.fn(),
}));

vi.mock("@opennextjs/core/core/resolve", () => ({
	resolveIncrementalCache: mockResolveIncrementalCache,
	resolveTagCache: mockResolveTagCache,
	resolveCdnInvalidation: mockResolveCdnInvalidation,
}));

vi.mock("@opennextjs/core/core/createGenericHandler", () => ({
	createGenericHandler: vi.fn(
		async ({
			handler: h,
		}: {
			handler: (event: InternalEvent, options?: unknown) => Promise<InternalResult>;
		}) => {
			//@ts-ignore
			globalThis.openNextConfig = {
				dangerous: {},
			} as Partial<OpenNextConfig>;
			return async (event: InternalEvent, options?: unknown) => h(event, options);
		}
	),
}));

function createEvent(overrides: Partial<InternalEvent> = {}): InternalEvent {
	return {
		type: "core",
		method: "GET",
		rawPath: "/cache/test-key",
		url: "https://on/cache/test-key",
		headers: {},
		query: {},
		cookies: {},
		remoteAddress: "127.0.0.1",
		...overrides,
	};
}

async function runHandler(event: InternalEvent): Promise<InternalResult> {
	return globalThis.__openNextAls.run(
		{
			requestId: "test-request",
			pendingPromiseRunner: {
				withResolvers: () => ({
					resolve: vi.fn(),
					promise: Promise.resolve(),
				}),
			},
			isISRRevalidation: false,
			writtenTags: new Set<string>(),
		},
		() => handler(event)
	);
}

describe("cache-adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.__openNextAls = new AsyncLocalStorage();
		// @ts-ignore
		globalThis.openNextConfig = { dangerous: {} } as Partial<OpenNextConfig>;
		mockResolveIncrementalCache.mockResolvedValue(mockIncrementalCache);
		mockResolveTagCache.mockResolvedValue(mockTagCache);
		mockResolveCdnInvalidation.mockResolvedValue(mockCdnInvalidationHandler);
		mockTagCache.mode = "original";
		mockTagCache.getPathsByTags = undefined;
	});

	describe("routing", () => {
		it("should return 404 for non-cache paths", async () => {
			const event = createEvent({ rawPath: "/other/path" });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(404);
			const body = await fromReadableStream(result.body);
			expect(body).toContain("Not Found");
		});

		it("should return 400 for missing cache key", async () => {
			const event = createEvent({ rawPath: "/cache/" });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
			const body = await fromReadableStream(result.body);
			expect(body).toContain("Missing cache key");
		});

		it("should return 405 for unknown method", async () => {
			const event = createEvent({ method: "PATCH" });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(405);
			const body = await fromReadableStream(result.body);
			expect(body).toContain("Method Not Allowed");
		});
	});

	describe("GET /cache/:key", () => {
		it("should return 404 when cache entry is not found", async () => {
			mockIncrementalCache.get.mockResolvedValue(null);

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(404);
			expect(result.headers["x-opennext-cache-found"]).toBe("false");
		});

		it("should return 404 when cache entry value is missing", async () => {
			mockIncrementalCache.get.mockResolvedValue({});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(404);
			expect(result.headers["x-opennext-cache-found"]).toBe("false");
		});

		it("should return 200 with route cache data", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "route", body: "route-body" },
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(result.headers["x-opennext-cache-found"]).toBe("true");
			expect(result.headers["x-opennext-cache-type"]).toBe("cache");
			expect(result.headers["x-opennext-cache-sub-type"]).toBe("route");
			expect(result.headers["x-opennext-cache-last-modified"]).toBe("1000");
			const body = await fromReadableStream(result.body);
			expect(body).toBe("route-body");
		});

		it("should return 200 with page cache data", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "page", html: "<html>", json: { data: 1 } },
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(result.headers["x-opennext-cache-type"]).toBe("cache");
			expect(result.headers["x-opennext-cache-sub-type"]).toBe("page");
			const body = await fromReadableStream(result.body);
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({ html: "<html>", json: { data: 1 } });
		});

		it("should return 200 with app cache data", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					type: "app",
					html: "<html>",
					rsc: "rsc-data",
					segmentData: { seg1: "data1" },
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(result.headers["x-opennext-cache-type"]).toBe("cache");
			expect(result.headers["x-opennext-cache-sub-type"]).toBe("app");
			const body = await fromReadableStream(result.body);
			const parsed = JSON.parse(body);
			expect(parsed.html).toBe("<html>");
			expect(parsed.rsc).toBe("rsc-data");
			expect(parsed.segmentData).toEqual({ seg1: "data1" });
		});

		it("should return 200 with redirect cache data", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "redirect", props: { destination: "/new" } },
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(result.headers["x-opennext-cache-type"]).toBe("cache");
			expect(result.headers["x-opennext-cache-sub-type"]).toBe("redirect");
		});

		it("should return 200 with fetch cache data", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					kind: "FETCH",
					data: {
						headers: { "content-type": "text/plain" },
						body: "fetch-body",
						url: "https://example.com",
						status: 200,
					},
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(result.headers["x-opennext-cache-type"]).toBe("fetch");
			expect(result.headers["x-opennext-cache-fetch-kind"]).toBe("FETCH");
			expect(result.headers["x-opennext-cache-fetch-data-url"]).toBe("https://example.com");
			const body = await fromReadableStream(result.body);
			expect(body).toBe("fetch-body");
		});

		it("should use ?type=fetch when query param is provided", async () => {
			mockIncrementalCache.get.mockResolvedValue(null);
			const event = createEvent({ query: { type: "fetch" } });

			await runHandler(event);

			expect(mockIncrementalCache.get).toHaveBeenCalledWith("test-key", "fetch");
		});

		it("should use ?type=cache by default", async () => {
			mockIncrementalCache.get.mockResolvedValue(null);

			await runHandler(createEvent());

			expect(mockIncrementalCache.get).toHaveBeenCalledWith("test-key", "cache");
		});

		it("should return 500 when incremental cache throws", async () => {
			mockIncrementalCache.get.mockRejectedValue(new Error("cache error"));

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(500);
		});
	});

	describe("tag revalidation in GET", () => {
		it("should return cached value when there are no tags", async () => {
			mockTagCache.mode = "original";
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "route", body: "data" },
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.getLastModified).not.toHaveBeenCalled();
		});

		it("should check tag revalidation in nextMode", async () => {
			mockTagCache.mode = "nextMode";
			mockTagCache.hasBeenRevalidated.mockResolvedValue(false);
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					type: "route",
					body: "data",
					meta: { headers: { "x-next-cache-tags": "tag1" } },
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(mockTagCache.hasBeenRevalidated).toHaveBeenCalledWith(["tag1"], 1000);
			expect(result.statusCode).toBe(200);
		});

		it("should return 404 when tags have been revalidated in nextMode", async () => {
			mockTagCache.mode = "nextMode";
			mockTagCache.hasBeenRevalidated.mockResolvedValue(true);
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					type: "route",
					body: "data",
					meta: { headers: { "x-next-cache-tags": "tag1" } },
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(404);
			expect(result.headers["x-opennext-cache-tag-status"]).toBe("revalidated");
		});

		it("should check last modified in original mode", async () => {
			mockTagCache.mode = "original";
			mockTagCache.getLastModified.mockResolvedValue(1000);
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					type: "route",
					body: "data",
					meta: { headers: { "x-next-cache-tags": "tag1" } },
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(mockTagCache.getLastModified).toHaveBeenCalledWith("test-key", 1000);
			expect(result.statusCode).toBe(200);
		});

		it("should return 404 when tags have been revalidated in original mode", async () => {
			mockTagCache.mode = "original";
			mockTagCache.getLastModified.mockResolvedValue(-1);
			mockIncrementalCache.get.mockResolvedValue({
				value: {
					type: "route",
					body: "data",
					meta: { headers: { "x-next-cache-tags": "tag1" } },
				},
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(404);
			expect(result.headers["x-opennext-cache-tag-status"]).toBe("revalidated");
		});

		it("should skip tag revalidation when shouldBypassTagCache is true", async () => {
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "route", body: "data" },
				lastModified: 1000,
				shouldBypassTagCache: true,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.getLastModified).not.toHaveBeenCalled();
			expect(mockTagCache.hasBeenRevalidated).not.toHaveBeenCalled();
		});

		it("should skip tag revalidation when disableTagCache is true", async () => {
			// @ts-ignore
			globalThis.openNextConfig = {
				dangerous: { disableTagCache: true },
			} as Partial<OpenNextConfig>;
			mockIncrementalCache.get.mockResolvedValue({
				value: { type: "route", body: "data" },
				lastModified: 1000,
			});

			const result = await runHandler(createEvent());

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.getLastModified).not.toHaveBeenCalled();
			expect(mockTagCache.hasBeenRevalidated).not.toHaveBeenCalled();
		});
	});

	describe("PUT /cache/:key", () => {
		it("should return 400 when body is missing", async () => {
			const result = await runHandler(createEvent({ method: "PUT" }));

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when body is empty", async () => {
			const event = createEvent({ method: "PUT", body: Buffer.from("") });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when value is missing in body", async () => {
			const event = createEvent({ method: "PUT", body: Buffer.from(JSON.stringify({})) });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when body is invalid JSON", async () => {
			const event = createEvent({ method: "PUT", body: Buffer.from("invalid json") });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should set cache entry and return 200", async () => {
			const value = { type: "route", body: "content" };
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(200);
			expect(mockIncrementalCache.set).toHaveBeenCalledWith("test-key", value, "cache");
			const body = await fromReadableStream(result.body);
			expect(JSON.parse(body)).toEqual({ ok: true });
		});

		it("should write derived tags for non-nextMode tag caches", async () => {
			mockTagCache.getByPath.mockResolvedValue([]);
			mockTagCache.mode = "original";

			const value = {
				type: "route",
				body: "content",
				meta: { headers: { "x-next-cache-tags": "tag1,tag2" } },
			};
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value })),
			});

			await runHandler(event);

			expect(mockTagCache.writeTags).toHaveBeenCalled();
		});

		it("should skip tag writing in nextMode", async () => {
			mockTagCache.mode = "nextMode";
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value: { type: "route", body: "content" } })),
			});

			await runHandler(event);

			expect(mockTagCache.writeTags).not.toHaveBeenCalled();
		});

		it("should skip tag writing when disableTagCache is true", async () => {
			// @ts-ignore
			globalThis.openNextConfig = {
				dangerous: { disableTagCache: true },
			} as Partial<OpenNextConfig>;
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value: { type: "route", body: "content" } })),
			});

			await runHandler(event);

			expect(mockTagCache.writeTags).not.toHaveBeenCalled();
		});

		it("should skip writing tags that are already stored", async () => {
			mockTagCache.getByPath.mockResolvedValue(["tag1", "tag2"]);

			const value = {
				type: "route",
				body: "content",
				meta: { headers: { "x-next-cache-tags": "tag1,tag2" } },
			};
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value })),
			});

			await runHandler(event);

			expect(mockTagCache.writeTags).not.toHaveBeenCalled();
		});

		it("should return 500 when set fails", async () => {
			mockIncrementalCache.set.mockRejectedValue(new Error("set error"));
			const event = createEvent({
				method: "PUT",
				body: Buffer.from(JSON.stringify({ value: { type: "route", body: "content" } })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(500);
		});
	});

	describe("DELETE /cache/:key", () => {
		it("should delete cache entry and return 200", async () => {
			const result = await runHandler(createEvent({ method: "DELETE" }));

			expect(result.statusCode).toBe(200);
			expect(mockIncrementalCache.delete).toHaveBeenCalledWith("test-key");
			const body = await fromReadableStream(result.body);
			expect(JSON.parse(body)).toEqual({ ok: true });
		});

		it("should return 500 when delete fails", async () => {
			mockIncrementalCache.delete.mockRejectedValue(new Error("delete error"));

			const result = await runHandler(createEvent({ method: "DELETE" }));

			expect(result.statusCode).toBe(500);
		});
	});

	describe("POST /cache/revalidate-tags", () => {
		it("should return 400 when body is missing", async () => {
			const event = createEvent({ rawPath: "/cache/revalidate-tags", method: "POST" });
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when body is empty", async () => {
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(""),
			});
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when tags array is missing", async () => {
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({})),
			});
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when tags are empty array", async () => {
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: [] })),
			});
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should return 400 when body is invalid JSON", async () => {
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from("not json"),
			});
			const result = await runHandler(event);

			expect(result.statusCode).toBe(400);
		});

		it("should revalidate tags in nextMode without getPathsByTags", async () => {
			mockTagCache.mode = "nextMode";
			mockTagCache.getPathsByTags = undefined;
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: ["tag1"] })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.writeTags).toHaveBeenCalled();
			const body = await fromReadableStream(result.body);
			const parsed = JSON.parse(body);
			expect(parsed.revalidated).toEqual(["tag1"]);
		});

		it("should revalidate tags in nextMode with getPathsByTags and invalidate CDN", async () => {
			mockTagCache.mode = "nextMode";
			mockTagCache.getPathsByTags = vi.fn().mockResolvedValue(["/path1"]);
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: ["tag1"] })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.writeTags).toHaveBeenCalled();
			expect(mockCdnInvalidationHandler.invalidatePaths).toHaveBeenCalledWith([
				expect.objectContaining({ initialPath: "/path1", rawPath: "/path1" }),
			]);
		});

		it("should revalidate tags in original mode", async () => {
			mockTagCache.mode = "original";
			mockTagCache.getByTag.mockResolvedValue(["/path1"]);
			mockTagCache.getByPath.mockResolvedValue([]);
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: ["tag1"] })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(200);
			expect(mockTagCache.getByTag).toHaveBeenCalledWith("tag1");
			expect(mockTagCache.writeTags).toHaveBeenCalled();
		});

		it("should invalidate CDN for soft tags in original mode", async () => {
			mockTagCache.mode = "original";
			mockTagCache.getByTag.mockResolvedValue(["/some-path"]);
			mockTagCache.getByPath.mockResolvedValue([]);
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: ["_N_T_//some-path"] })),
			});

			await runHandler(event);

			expect(mockCdnInvalidationHandler.invalidatePaths).toHaveBeenCalled();
		});

		it("should return 500 when revalidation fails", async () => {
			mockTagCache.mode = "original";
			mockTagCache.getByTag.mockRejectedValue(new Error("tag error"));
			const event = createEvent({
				rawPath: "/cache/revalidate-tags",
				method: "POST",
				body: Buffer.from(JSON.stringify({ tags: ["tag1"] })),
			});

			const result = await runHandler(event);

			expect(result.statusCode).toBe(500);
		});
	});
});
