import path from "node:path";

import { debug, error } from "@opennextjs/core/adapters/logger.js";
import { chunk, parseNumberFromEnv } from "@opennextjs/core/adapters/util.js";
import type { NextModeTagCache, NextModeTagCacheWriteInput } from "@opennextjs/core/types/overrides.js";
import { RecoverableError } from "@opennextjs/core/utils/error.js";
import { RequestCache } from "@opennextjs/core/utils/requestCache.js";
import { AwsClient } from "aws4fetch";

import { customFetchClient } from "../../utils/fetch.js";

import { MAX_DYNAMO_BATCH_WRITE_ITEM_COUNT, getDynamoBatchWriteCommandConcurrency } from "./constants.js";

type DynamoDBTagItem = {
	revalidatedAt: { N: string };
	tag: { S: string };
	stale?: { N: string };
	expire?: { N: string };
};

type DynamoDBBatchGetResponse = {
	Responses?: Record<string, DynamoDBTagItem[]>;
};

let awsClient: AwsClient | null = null;

const getAwsClient = () => {
	const { CACHE_BUCKET_REGION } = process.env;
	if (awsClient) {
		return awsClient;
	}
	awsClient = new AwsClient({
		accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
		sessionToken: process.env.AWS_SESSION_TOKEN,
		region: CACHE_BUCKET_REGION,
		retries: parseNumberFromEnv(process.env.AWS_SDK_S3_MAX_ATTEMPTS),
	});
	return awsClient;
};
const awsFetch = (body: RequestInit["body"], type: "query" | "batchWrite" = "query") => {
	const { CACHE_BUCKET_REGION } = process.env;
	const client = getAwsClient();
	return customFetchClient(client)(`https://dynamodb.${CACHE_BUCKET_REGION}.amazonaws.com`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-amz-json-1.0",
			"X-Amz-Target": `DynamoDB_20120810.${type === "query" ? "BatchGetItem" : "BatchWriteItem"}`,
		},
		body,
	});
};

function buildDynamoKey(key: string) {
	const { NEXT_BUILD_ID } = process.env;
	// FIXME: We should probably use something else than path.join here
	// this could transform some fetch cache key into a valid path
	return path.posix.join(NEXT_BUILD_ID ?? "", "_tag", key);
}

// We use the same key for both path and tag
// That's mostly for compatibility reason so that it's easier to use this with existing infra
// FIXME: Allow a simpler object without an unnecessary path key
function buildDynamoObject(tag: string, revalidatedAt?: number, stale?: number, expire?: number) {
	return {
		path: { S: buildDynamoKey(tag) },
		tag: { S: buildDynamoKey(tag) },
		revalidatedAt: { N: `${revalidatedAt ?? Date.now()}` },
		...(stale !== undefined ? { stale: { N: `${stale}` } } : {}),
		...(expire !== undefined ? { expire: { N: `${expire}` } } : {}),
	};
}

function fetchTagItems(tags: string[]): Promise<DynamoDBTagItem[]> {
	const { CACHE_DYNAMO_TABLE } = process.env;

	return awsFetch(
		JSON.stringify({
			RequestItems: {
				[CACHE_DYNAMO_TABLE ?? ""]: {
					Keys: tags.map((tag) => ({
						path: { S: buildDynamoKey(tag) },
						tag: { S: buildDynamoKey(tag) },
					})),
				},
			},
		}),
		"query"
	).then(async (response) => {
		if (response.status !== 200) {
			throw new RecoverableError(`Failed to query dynamo item: ${response.status}`);
		}
		const { Responses } = (await response.json()) as DynamoDBBatchGetResponse;
		return Responses?.[CACHE_DYNAMO_TABLE ?? ""] ?? [];
	});
}

const requestCache = new RequestCache<string, DynamoDBTagItem[]>();

function getCachedTagItems(tags: string[]): Promise<DynamoDBTagItem[]> {
	const cacheKey = [...tags].sort().join(",");
	return requestCache.getOrSet(cacheKey, () => fetchTagItems(tags));
}

// This implementation does not support automatic invalidation of paths by the cdn
export default {
	name: "ddb-nextMode",
	mode: "nextMode",
	getLastRevalidated: async (tags: string[]) => {
		// Not supported for now
		return 0;
	},
	hasBeenRevalidated: async (tags: string[], lastModified?: number) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache) {
			return false;
		}
		if (tags.length > 100) {
			throw new RecoverableError(
				"Cannot query more than 100 tags at once. You should not be using this tagCache implementation for this amount of tags"
			);
		}
		const items = await getCachedTagItems(tags);

		const now = Date.now();
		const revalidatedTags = items.filter((item) => {
			const revalidatedAt = Number.parseInt(item.revalidatedAt.N);
			if (revalidatedAt > (lastModified ?? 0)) {
				return true;
			}
			// If the tag has expired (expire time is in the past), it counts as revalidated
			if (item.expire?.N) {
				const expireTime = Number.parseInt(item.expire.N);
				if (expireTime <= now && expireTime > (lastModified ?? 0)) {
					return true;
				}
			}
			return false;
		});
		debug("retrieved tags", revalidatedTags);
		return revalidatedTags.length > 0;
	},
	isStale: async (tags: string[], lastModified?: number) => {
		if (globalThis.openNextConfig.dangerous?.disableTagCache) {
			return false;
		}
		if (tags.length === 0) {
			return false;
		}
		if (tags.length > 100) {
			throw new RecoverableError(
				"Cannot query more than 100 tags at once. You should not be using this tagCache implementation for this amount of tags"
			);
		}
		const items = await getCachedTagItems(tags);

		const hasStaleTag = items.some((item) => {
			if (!item?.stale?.N) return false;
			const revalidatedAt = Number.parseInt(item.revalidatedAt?.N ?? "0");
			// A tag is stale when both its stale timestamp and its revalidatedAt are newer than the page.
			// revalidatedAt > lastModified ensures the revalidation that set this stale window happened
			// after the page was generated, preventing a stale signal from a previous ISR cycle.
			return revalidatedAt > (lastModified ?? 0) && Number.parseInt(item.stale.N) >= (lastModified ?? 0);
		});
		debug("isStale result:", hasStaleTag);
		return hasStaleTag;
	},
	writeTags: async (tags: (string | NextModeTagCacheWriteInput)[]) => {
		try {
			const { CACHE_DYNAMO_TABLE } = process.env;
			if (globalThis.openNextConfig.dangerous?.disableTagCache) {
				return;
			}
			const now = Date.now();
			const dataChunks = chunk(tags, MAX_DYNAMO_BATCH_WRITE_ITEM_COUNT).map((Items) => ({
				RequestItems: {
					[CACHE_DYNAMO_TABLE ?? ""]: Items.map((tag) => {
						if (typeof tag === "string") {
							return {
								PutRequest: {
									Item: buildDynamoObject(tag, now),
								},
							};
						}
						return {
							PutRequest: {
								Item: buildDynamoObject(tag.tag, now, tag.stale, tag.expire),
							},
						};
					}),
				},
			}));
			const toInsert = chunk(dataChunks, getDynamoBatchWriteCommandConcurrency());
			for (const paramsChunk of toInsert) {
				await Promise.all(
					paramsChunk.map(async (params) => {
						const response = await awsFetch(JSON.stringify(params), "batchWrite");
						if (response.status !== 200) {
							throw new RecoverableError(`Failed to batch write dynamo item: ${response.status}`);
						}
						return response;
					})
				);
			}
		} catch (e) {
			error("Failed to batch write dynamo item", e);
		}
	},
} satisfies NextModeTagCache;
