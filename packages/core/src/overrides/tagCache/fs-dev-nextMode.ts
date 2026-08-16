import type { NextModeTagCache, NextModeTagCacheWriteInput } from "@/types/overrides";

import { debug } from "../../adapters/logger";

type TagData = {
	revalidatedAt: number;
	stale?: number;
	expire?: number;
};

const tagsMap = new Map<string, TagData>();

export default {
	name: "fs-dev-nextMode",
	mode: "nextMode",
	getLastRevalidated: async (tags: string[]) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache) {
			return 0;
		}

		let lastRevalidated = 0;

		tags.forEach((tag) => {
			const tagTime = tagsMap.get(tag)?.revalidatedAt;
			if (tagTime && tagTime > lastRevalidated) {
				lastRevalidated = tagTime;
			}
		});

		debug("getLastRevalidated result:", lastRevalidated);
		return lastRevalidated;
	},
	hasBeenRevalidated: async (tags: string[], lastModified?: number) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache) {
			return false;
		}

		const hasRevalidatedTag = tags.some((tag) => {
			const tagData = tagsMap.get(tag);
			return tagData ? tagData.revalidatedAt > (lastModified ?? 0) : false;
		});

		debug("hasBeenRevalidated result:", hasRevalidatedTag);
		return hasRevalidatedTag;
	},
	isStale: async (tags: string[], lastModified?: number) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache) {
			return false;
		}

		const hasStaleTag = tags.some((tag) => {
			const tagData = tagsMap.get(tag);
			if (!tagData || typeof tagData.stale !== "number") {
				return false;
			}
			// A tag is stale when both its stale timestamp and its revalidatedAt are newer than the page.
			// revalidatedAt > lastModified ensures the revalidation that set this stale window happened
			// after the page was generated, preventing a stale signal from a previous ISR cycle.
			return tagData.revalidatedAt > (lastModified ?? 0) && tagData.stale >= (lastModified ?? 0);
		});
		debug("isStale result:", hasStaleTag);
		return hasStaleTag;
	},
	writeTags: async (tags: (string | NextModeTagCacheWriteInput)[]) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache || tags.length === 0) {
			return;
		}

		debug("writeTags", { tags });

		const now = Date.now();
		tags.forEach((tag) => {
			if (typeof tag === "string") {
				tagsMap.set(tag, { revalidatedAt: now });
			} else {
				tagsMap.set(tag.tag, {
					revalidatedAt: now,
					...(tag.stale !== undefined ? { stale: tag.stale } : {}),
					...(tag.expire !== undefined ? { expire: tag.expire } : {}),
				});
			}
		});

		debug("writeTags completed, written", tags.length, "tags");
	},
} satisfies NextModeTagCache;
