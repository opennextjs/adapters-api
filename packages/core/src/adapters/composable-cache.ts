import type { ComposableCacheEntry, ComposableCacheHandler } from "@/types/cache";
import type { CacheValue } from "@/types/overrides";
import { fromReadableStream, toReadableStream } from "@/utils/stream";

import { debug } from "./logger";

const pendingWritePromiseMap = new Map<string, Promise<CacheValue<"composable">>>();

export default {
	async get(cacheKey: string) {
		try {
			// We first check if we have a pending write for this cache key
			// If we do, we return the pending promise instead of fetching the cache
			if (pendingWritePromiseMap.has(cacheKey)) {
				const stored = pendingWritePromiseMap.get(cacheKey);
				if (stored) {
					return stored.then((entry) => ({
						...entry,
						value: toReadableStream(entry.value),
					}));
				}
			}
			const result = await globalThis.cache.get(cacheKey, "composable");
			if (!result?.value?.value) {
				return undefined;
			}

			debug("composable cache result", result);

			let revalidate = result.value.revalidate;
			// If the cache adapter signaled staleness via lastModified=1, trigger SWR
			if (result.lastModified === 1) {
				revalidate = -1;
			}

			return {
				...result.value,
				revalidate,
				value: toReadableStream(result.value.value),
			};
		} catch (e) {
			debug("Cannot read composable cache entry");
			return undefined;
		}
	},

	async set(cacheKey: string, pendingEntry: Promise<ComposableCacheEntry>) {
		const promiseEntry = pendingEntry.then(async (entry) => ({
			...entry,
			value: await fromReadableStream(entry.value),
		}));
		pendingWritePromiseMap.set(cacheKey, promiseEntry);

		const entry = await promiseEntry.finally(() => {
			pendingWritePromiseMap.delete(cacheKey);
		});
		await globalThis.cache.set(
			cacheKey,
			{
				...entry,
				value: entry.value,
			},
			"composable"
		);
	},

	async refreshTags() {
		// We don't do anything for now, do we want to do something here ???
		return;
	},

	/**
	 * The signature has changed in Next.js 16
	 * - Before Next.js 16, the method takes `...tags: string[]`
	 * - From Next.js 16, the method takes `tags: string[]`
	 */
	async getExpiration(...tags: string[] | string[][]) {
		// Tag revalidation is handled transparently in the cache layer's get(),
		// so we always return 0 here to let get() determine freshness.
		return 0;
	},

	/**
	 * This method is only used before Next.js 16
	 */
	async expireTags(...tags: string[]) {
		const flatTags = tags.flat();
		if (flatTags.length > 0) {
			await globalThis.cache.revalidateTags(flatTags);
		}
	},

	/**
	 * Added in Next.js 16. Updates tags with optional stale/expire durations.
	 * Mirrors the revalidateTag logic but without CDN invalidation
	 * since composable cache keys are not URL paths.
	 */
	async updateTags(tags: string[], durations?: { expire?: number }) {
		if (tags.length === 0) {
			return;
		}
		try {
			await globalThis.cache.revalidateTags(tags, {
				expire: durations?.expire ? Date.now() + durations.expire * 1000 : undefined,
			});
		} catch (e) {
			debug("Failed to update tags", e);
		}
	},

	// This one is necessary for older versions of next
	async receiveExpiredTags(...tags: string[]) {
		// This function does absolutely nothing
		return;
	},
} satisfies ComposableCacheHandler;
