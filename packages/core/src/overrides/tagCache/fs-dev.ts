import fs from "node:fs";
import path from "node:path";

import type { OriginalTagCacheWriteInput, TagCache } from "@/types/overrides";
import { getMonorepoRelativePath } from "@/utils/normalize-path";

const tagFile = path.join(getMonorepoRelativePath(), "dynamodb-provider/dynamodb-cache.json");
const tagContent = fs.readFileSync(tagFile, "utf-8");

type TagEntry = {
	tag: { S: string };
	path: { S: string };
	revalidatedAt: { N: string };
	stale?: { N: string };
	expire?: { N: string };
};

let tags = JSON.parse(tagContent) as TagEntry[];

const { NEXT_BUILD_ID } = process.env;

function buildKey(key: string) {
	return path.posix.join(NEXT_BUILD_ID ?? "", key);
}

const tagCache: TagCache = {
	name: "fs-dev",
	mode: "original",
	getByPath: async (path: string) => {
		return tags
			.filter((tagPathMapping) => tagPathMapping.path.S === buildKey(path))
			.map((tag) => tag.tag.S.replace(`${NEXT_BUILD_ID}/`, ""));
	},
	getByTag: async (tag: string) => {
		return tags
			.filter((tagPathMapping) => tagPathMapping.tag.S === buildKey(tag))
			.map((tagEntry) => tagEntry.path.S.replace(`${NEXT_BUILD_ID}/`, ""));
	},
	getLastModified: async (path: string, lastModified?: number) => {
		const revalidatedTags = tags.filter(
			(tagPathMapping) =>
				tagPathMapping.path.S === buildKey(path) &&
				Number.parseInt(tagPathMapping.revalidatedAt.N) > (lastModified ?? 0)
		);
		return revalidatedTags.length > 0 ? -1 : (lastModified ?? Date.now());
	},
	isStale: async (path: string, lastModified?: number) => {
		const matchingTags = tags.filter((tagPathMapping) => tagPathMapping.path.S === buildKey(path));
		return matchingTags.some((entry) => {
			if (!entry.stale?.N) return false;
			// A tag is stale when both its stale timestamp and its revalidatedAt are newer than the page.
			// revalidatedAt > lastModified ensures the revalidation that set this stale window happened
			// after the page was generated, preventing a stale signal from a previous ISR cycle.
			return (
				Number.parseInt(entry.revalidatedAt.N) > (lastModified ?? 0) &&
				Number.parseInt(entry.stale.N) > (lastModified ?? 0)
			);
		});
	},
	writeTags: async (newTags: OriginalTagCacheWriteInput[]) => {
		const newTagsSet = new Set(newTags.map(({ tag, path }) => `${buildKey(tag)}-${buildKey(path)}`));
		const unchangedTags = tags.filter(({ tag, path }) => !newTagsSet.has(`${tag.S}-${path.S}`));
		tags = unchangedTags.concat(
			newTags.map((item) => ({
				tag: { S: buildKey(item.tag) },
				path: { S: buildKey(item.path) },
				revalidatedAt: { N: `${item.revalidatedAt ?? Date.now()}` },
				...(item.stale !== undefined ? { stale: { N: `${item.stale}` } } : {}),
				...(item.expire !== undefined ? { expire: { N: `${item.expire}` } } : {}),
			}))
		);
	},
};

export default tagCache;
