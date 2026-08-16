import type { StoredComposableCacheEntry } from "@/types/cache";
import type { CacheEntryType, CacheValue } from "@/types/overrides";

import { error } from "../adapters/logger";

export const CACHE_ONE_YEAR = 60 * 60 * 24 * 365;

const NO_STORE = "no-store";

/**
 * Composable cache entries may carry `Infinity` (i.e. `cacheLife("max")`), and an entry that was
 * just written has a negative age when `Date.now()` drifts, so every duration is clamped.
 */
function clampSeconds(seconds: number): number {
	if (!Number.isFinite(seconds)) {
		return CACHE_ONE_YEAR;
	}
	return Math.max(0, Math.min(Math.floor(seconds), CACHE_ONE_YEAR));
}

function buildCacheControl(sMaxAge: number, staleWhileRevalidate: number): string {
	return `s-maxage=${clampSeconds(sMaxAge)}, stale-while-revalidate=${clampSeconds(staleWhileRevalidate)}`;
}

/**
 * Computes the `Cache-Control` of a cache handler `GET` hit, so that an HTTP cache sitting in front
 * of the cache handler function can serve reads without hitting the underlying store.
 *
 * A stale or expired entry is never stored: the next read has to reach the cache handler function so
 * that the staleness is signaled to the server (through `lastModified = 1`).
 *
 * **This is only correct when the cached responses can be purged**, either with a
 * `cdnInvalidationHandler` or through another purge mechanism keyed on the `cache-tag` header that
 * `buildCacheGetResponse` emits. Tag revalidation cannot invalidate an intermediate cache on its own,
 * so without purging `revalidateTag`/`revalidatePath` would be masked for as long as the entry is
 * stored - up to a year for SSG entries.
 */
export function computeEntryCacheControl(
	value: CacheValue<CacheEntryType>,
	lastModified: number | undefined,
	isStaleFromTagCache: boolean
): string {
	if (isStaleFromTagCache) {
		return NO_STORE;
	}

	// Same discrimination as `buildCacheGetResponse`: fetch entries have a `kind`, cached files have
	// a `type`, composable entries have neither.
	const isFetch = "kind" in value && value.kind === "FETCH";
	const isCachedFile = "type" in value;

	if (!isFetch && !isCachedFile) {
		return computeComposableCacheControl(value as StoredComposableCacheEntry);
	}

	return computeRevalidateCacheControl(value.revalidate, lastModified);
}

function computeComposableCacheControl(value: StoredComposableCacheEntry): string {
	const age = (Date.now() - value.timestamp) / 1000;

	if (age >= value.expire || age >= value.revalidate) {
		return NO_STORE;
	}

	// Composable entries are the only ones carrying an explicit `expire`, so they are also the only
	// ones for which we can derive a real stale-while-revalidate window.
	return buildCacheControl(value.revalidate - age, value.expire - value.revalidate);
}

function computeRevalidateCacheControl(
	revalidate: number | false | undefined,
	lastModified: number | undefined
): string {
	if (revalidate === 0) {
		return NO_STORE;
	}

	if (revalidate === undefined) {
		// `revalidate` is written by the cache handler for every entry, we should always have one here.
		error("Missing `revalidate` on a cache entry, assuming it is a static (SSG) entry");
	}

	if (revalidate === undefined || revalidate === false) {
		return buildCacheControl(CACHE_ONE_YEAR, 0);
	}

	const age = (Date.now() - (lastModified ?? Date.now())) / 1000;
	const remainingTtl = revalidate - age;

	if (remainingTtl <= 0) {
		return NO_STORE;
	}

	// `stale-while-revalidate` is intentionally `0` for fetch and cached file entries: a response
	// served during a stale-while-revalidate window still carries its original
	// `x-opennext-cache-last-modified`, which would hide the `lastModified = 1` staleness signal that
	// `cacheInterceptor` and the composable cache rely on to trigger a background revalidation.
	return buildCacheControl(remainingTtl, 0);
}
