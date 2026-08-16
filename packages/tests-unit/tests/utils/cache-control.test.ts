import type { StoredComposableCacheEntry } from "@opennextjs/core/types/cache";
import type { CacheEntryType, CacheValue } from "@opennextjs/core/types/overrides";
import { CACHE_ONE_YEAR, computeEntryCacheControl } from "@opennextjs/core/utils/cache-control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_700_000_000_000;

function composable(overrides: Partial<StoredComposableCacheEntry> = {}): CacheValue<"composable"> {
	return {
		value: "composable-body",
		tags: [],
		timestamp: NOW,
		revalidate: 60,
		expire: 300,
		stale: 5,
		...overrides,
	};
}

function fetchEntry(revalidate?: number | false): CacheValue<"fetch"> {
	return {
		kind: "FETCH",
		data: { headers: {}, body: "fetch-body", url: "https://example.com" },
		...(revalidate !== undefined ? { revalidate } : {}),
	};
}

function cachedFile(revalidate?: number | false): CacheValue<"cache"> {
	return {
		type: "route",
		body: "route-body",
		...(revalidate !== undefined ? { revalidate } : {}),
	};
}

function compute(
	value: CacheValue<CacheEntryType>,
	lastModified?: number,
	isStaleFromTagCache = false
): string {
	return computeEntryCacheControl(value, lastModified, isStaleFromTagCache);
}

describe("computeEntryCacheControl", () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		errorSpy.mockRestore();
	});

	it("should not store an entry that is stale from the tag cache", () => {
		expect(compute(cachedFile(60), NOW, true)).toBe("no-store");
		expect(compute(composable(), NOW, true)).toBe("no-store");
		expect(compute(fetchEntry(60), NOW, true)).toBe("no-store");
	});

	describe("composable entries", () => {
		it("should compute the remaining revalidate window and the stale window", () => {
			vi.setSystemTime(NOW + 20_000);

			expect(compute(composable())).toBe("s-maxage=40, stale-while-revalidate=240");
		});

		it("should not store a stale entry", () => {
			vi.setSystemTime(NOW + 60_000);

			expect(compute(composable())).toBe("no-store");
		});

		it("should not store an expired entry", () => {
			vi.setSystemTime(NOW + 300_000);

			expect(compute(composable({ revalidate: 600 }))).toBe("no-store");
		});

		it("should clamp infinite durations to a year", () => {
			expect(
				compute(composable({ revalidate: Number.POSITIVE_INFINITY, expire: Number.POSITIVE_INFINITY }))
			).toBe(`s-maxage=${CACHE_ONE_YEAR}, stale-while-revalidate=${CACHE_ONE_YEAR}`);
		});
	});

	describe("fetch entries", () => {
		it("should compute the remaining ttl", () => {
			vi.setSystemTime(NOW + 10_000);

			expect(compute(fetchEntry(60), NOW)).toBe("s-maxage=50, stale-while-revalidate=0");
		});

		it("should not store an entry past its revalidate window", () => {
			vi.setSystemTime(NOW + 60_000);

			expect(compute(fetchEntry(60), NOW)).toBe("no-store");
		});
	});

	describe("cached file entries", () => {
		it("should compute the remaining ttl", () => {
			vi.setSystemTime(NOW + 30_000);

			expect(compute(cachedFile(120), NOW)).toBe("s-maxage=90, stale-while-revalidate=0");
		});

		it("should cache SSG entries for a year", () => {
			expect(compute(cachedFile(false), NOW)).toBe(`s-maxage=${CACHE_ONE_YEAR}, stale-while-revalidate=0`);
			expect(errorSpy).not.toHaveBeenCalled();
		});

		it("should assume SSG and log an error when revalidate is missing", () => {
			expect(compute(cachedFile(), NOW)).toBe(`s-maxage=${CACHE_ONE_YEAR}, stale-while-revalidate=0`);
			expect(errorSpy).toHaveBeenCalledWith(
				"Missing `revalidate` on a cache entry, assuming it is a static (SSG) entry"
			);
		});

		it("should not store an entry with a revalidate of 0", () => {
			expect(compute(cachedFile(0), NOW)).toBe("no-store");
		});

		it("should treat a missing lastModified as a fresh entry", () => {
			expect(compute(cachedFile(60))).toBe("s-maxage=60, stale-while-revalidate=0");
		});
	});
});
