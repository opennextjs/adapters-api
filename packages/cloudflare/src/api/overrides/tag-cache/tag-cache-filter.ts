import { NextModeTagCache, NextModeTagCacheWriteInput } from "@opennextjs/core/types/overrides.js";

interface WithFilterOptions {
	/**
	 * The original tag cache.
	 */
	tagCache: NextModeTagCache;

	/**
	 * Filter function that returns true if the tag should be forwarded to the underlying tag cache.
	 * @returns true if the tag should be forwarded, false otherwise.
	 */
	filterFn: (tag: string | NextModeTagCacheWriteInput) => boolean;
}

/**
 * Creates a new tag cache that filters tags based on the provided filter function.
 * This is useful to remove tags that are not used by the app, this could reduce the number of requests to the underlying tag cache.
 */
export function withFilter({ tagCache, filterFn }: WithFilterOptions): NextModeTagCache {
	return {
		name: `filtered-${tagCache.name}`,
		mode: "nextMode",
		getLastRevalidated: async (tags) => {
			const filteredTags = tags.filter(filterFn);
			if (filteredTags.length === 0) {
				return 0;
			}
			return tagCache.getLastRevalidated(filteredTags);
		},
		getPathsByTags: tagCache.getPathsByTags
			? async (tags) => {
					const filteredTags = tags.filter(filterFn);
					if (filteredTags.length === 0) {
						return [];
					}
					return tagCache.getPathsByTags!(filteredTags);
				}
			: undefined,
		hasBeenRevalidated: async (tags, lastModified) => {
			const filteredTags = tags.filter(filterFn);
			if (filteredTags.length === 0) {
				return false;
			}
			return tagCache.hasBeenRevalidated(filteredTags, lastModified);
		},
		writeTags: async (tags) => {
			const filteredTags = tags.filter(filterFn);
			if (filteredTags.length === 0) {
				return;
			}
			return tagCache.writeTags(filteredTags);
		},
	};
}

/**
 * Filter function to exclude tags that start with "_N_T_".
 * This is used to filter out internal soft tags.
 * Can be used if `revalidatePath` is not used.
 */
export function softTagFilter(tag: string | { tag: string }): boolean {
	const tagStr = typeof tag === "string" ? tag : tag.tag;
	return !tagStr.startsWith("_N_T_");
}
