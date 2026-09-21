import { AsyncLocalStorage } from "node:async_hooks";

import { handler } from "@opennextjs/core/adapters/cache-handler";
import type { InternalEvent } from "@opennextjs/core/types/open-next";
import { toReadableStream } from "@opennextjs/core/utils/stream";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	incrementalCache: {
		get: vi.fn(),
		set: vi.fn(),
		delete: vi.fn(),
	},
	tagCache: {
		mode: "nextMode" as const,
		getPathsByTags: vi.fn().mockResolvedValue([]),
		writeTags: vi.fn(),
	},
	cdnInvalidationHandler: {
		invalidatePaths: vi.fn(),
	},
}));

vi.mock("@opennextjs/core/core/createGenericHandler", () => ({
	createGenericHandler: vi.fn(async ({ handler }) => handler),
}));

vi.mock("@opennextjs/core/core/resolve", () => ({
	resolveIncrementalCache: vi.fn().mockResolvedValue(mocks.incrementalCache),
	resolveTagCache: vi.fn().mockResolvedValue(mocks.tagCache),
	resolveCdnInvalidation: vi.fn().mockResolvedValue(mocks.cdnInvalidationHandler),
}));

vi.mock("@opennextjs/core/utils/cache", () => ({
	writeTags: vi.fn(),
}));

function createEvent(method: string, rawPath: string, body?: string): InternalEvent {
	return {
		type: "core",
		method,
		rawPath,
		url: `https://cache.test${rawPath}`,
		headers: {},
		query: {},
		cookies: {},
		remoteAddress: "127.0.0.1",
		body: body === undefined ? undefined : toReadableStream(body),
	};
}

describe("cache adapter stream bodies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.openNextConfig = { default: {} };
	});

	test("preserves existing request context storage", async () => {
		const requestStorage = new AsyncLocalStorage();
		globalThis.__openNextAls = requestStorage;
		vi.resetModules();

		await import("@opennextjs/core/adapters/cache-handler");

		expect(globalThis.__openNextAls).toBe(requestStorage);
	});

	test("stores a value from a streamed request body", async () => {
		const value = { type: "route", body: "content" };
		const result = await handler(createEvent("PUT", "/cache/key", JSON.stringify({ value })));

		expect(result.statusCode).toBe(200);
		expect(mocks.incrementalCache.set).toHaveBeenCalledWith("key", value, "cache");
	});

	test("revalidates tags from a streamed request body", async () => {
		const result = await handler(
			createEvent("POST", "/cache/revalidate-tags", JSON.stringify({ tags: ["one", "two"] }))
		);

		expect(result.statusCode).toBe(200);
		expect(mocks.tagCache.getPathsByTags).toHaveBeenCalledWith(["one", "two"]);
	});

	test("rejects non-string tags", async () => {
		const result = await handler(
			createEvent("POST", "/cache/revalidate-tags", JSON.stringify({ tags: ["one", 2] }))
		);

		expect(result.statusCode).toBe(400);
		expect(mocks.tagCache.getPathsByTags).not.toHaveBeenCalled();
		expect(mocks.tagCache.writeTags).not.toHaveBeenCalled();
		expect(mocks.cdnInvalidationHandler.invalidatePaths).not.toHaveBeenCalled();
	});
});
