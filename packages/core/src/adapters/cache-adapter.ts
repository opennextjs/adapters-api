import { AsyncLocalStorage } from "node:async_hooks";

import type { StoredComposableCacheEntry } from "@/types/cache";
import type { InternalEvent, InternalResult } from "@/types/open-next";
import type {
	CacheEntryType,
	CachedFile,
	CachedFetchValue,
	CacheValue,
	OpenNextHandlerOptions,
	WithLastModified,
} from "@/types/overrides";

import { createGenericHandler } from "../core/createGenericHandler.js";
import { resolveCdnInvalidation, resolveIncrementalCache, resolveTagCache } from "../core/resolve.js";
import { getTagsFromValue, isStale, writeTags } from "../utils/cache.js";
import { runWithOpenNextRequestContext } from "../utils/promise.js";
import { toReadableStream } from "../utils/stream.js";

import { debug, error } from "./logger.js";

globalThis.__openNextAls = new AsyncLocalStorage();

const SOFT_TAG_PREFIX = "_N_T_/";

// Whether caches have been initialized
let initialized = false;

async function initializeCaches() {
	if (initialized) return;
	const config = globalThis.openNextConfig;

	globalThis.incrementalCache = await resolveIncrementalCache(config.cacheHandler?.incrementalCache);

	globalThis.tagCache = await resolveTagCache(config.cacheHandler?.tagCache);

	globalThis.cdnInvalidationHandler = await resolveCdnInvalidation(
		config.cacheHandler?.cdnInvalidation ?? config.default?.override?.cdnInvalidation
	);

	initialized = true;
}

/////////////
// Handler //
/////////////

export const handler = await createGenericHandler({
	handler: defaultHandler,
	type: "cache",
});

async function defaultHandler(
	event: InternalEvent,
	options?: OpenNextHandlerOptions
): Promise<InternalResult> {
	debug("cache handler event", event);

	try {
		await initializeCaches();
	} catch (e) {
		error("Failed to initialize caches", e);
		return buildErrorResponse("Internal server error", 500);
	}

	const { method, rawPath, query, body } = event;

	try {
		// POST /cache/revalidate-tags
		if (method === "POST" && rawPath === "/cache/revalidate-tags") {
			return await handleRevalidateTags(body);
		}

		// All other operations must be on /cache/*
		if (!rawPath.startsWith("/cache/")) {
			return buildErrorResponse("Not Found", 404);
		}

		const key = decodeURIComponent(rawPath.slice("/cache/".length));

		if (!key) {
			return buildErrorResponse("Missing cache key", 400);
		}

		const rawType = typeof query?.type === "string" ? query.type : undefined;
		const cacheType: CacheEntryType = rawType === "fetch" || rawType === "composable" ? rawType : "cache";

		const additionalTags = query?.tags ? (query.tags as string).split(",") : [];

		switch (method) {
			case "GET":
				return await handleGet(key, cacheType, additionalTags);
			case "PUT":
				return await handleSet(key, cacheType, body);
			case "DELETE":
				return await handleDelete(key);
			default:
				return buildErrorResponse("Method Not Allowed", 405);
		}
	} catch (e) {
		error("Failed to handle cache request", e);
		return buildErrorResponse("Internal server error", 500);
	}
}

//////////////////////
// Route handlers   //
//////////////////////

async function handleGet(
	key: string,
	cacheType: CacheEntryType,
	additionalTags: string[]
): Promise<InternalResult> {
	debug("get", { key, cacheType, additionalTags });

	try {
		const result = await globalThis.incrementalCache.get(key, cacheType);

		if (!result?.value) {
			return {
				type: "core",
				statusCode: 404,
				body: toReadableStream(""),
				isBase64Encoded: false,
				headers: {
					"x-opennext-cache-found": "false",
					"Cache-Control": "no-store",
				},
			};
		}

		// `getTagsFromValue` also strips the internal `x-next-cache-tags` header from the entry, so
		// the tags are derived for every hit - including the ones bypassing the tag cache - or that
		// header would be handed back to Next.js and echoed to the client.
		let tags: string[] = [...additionalTags];

		if (cacheType === "cache") {
			tags = [...tags, ...getTagsFromValue(result.value as CacheValue<"cache">)];
		} else if (cacheType === "fetch") {
			const fetchValue = result.value as CachedFetchValue;
			tags = [...tags, ...(fetchValue.tags ?? []), ...(fetchValue.data?.tags ?? [])];
		} else if (cacheType === "composable") {
			const composableValue = result.value as StoredComposableCacheEntry;
			tags = [...tags, ...(composableValue.tags ?? [])];
		}

		if (!result.shouldBypassTagCache) {
			const lastModified = result.lastModified ?? Date.now();

			if (tags.length > 0) {
				const revalidated = await checkTagRevalidation(key, tags, result);
				if (revalidated) {
					return {
						type: "core",
						statusCode: 404,
						body: toReadableStream(""),
						isBase64Encoded: false,
						headers: {
							"x-opennext-cache-found": "false",
							"x-opennext-cache-tag-status": "revalidated",
							"Cache-Control": "no-store",
						},
					};
				}
			}

			// Check if the cache entry is stale (valid but needs background revalidation)
			const _isStale = tags.length > 0 ? await isStale(key, tags, lastModified) : false;
			if (_isStale) {
				result.lastModified = 1;
			}
		}

		return buildCacheGetResponse(result);
	} catch (e) {
		error("Failed to get cache entry", e);
		return buildErrorResponse("Failed to get cache entry", 500);
	}
}

async function checkTagRevalidation(
	key: string,
	tags: string[],
	cacheEntry: WithLastModified<CacheValue<CacheEntryType>>
): Promise<boolean> {
	if (globalThis.openNextConfig?.dangerous?.disableTagCache || tags.length === 0) {
		return false;
	}
	const lastModified = cacheEntry.lastModified ?? Date.now();
	if (globalThis.tagCache.mode === "nextMode") {
		return globalThis.tagCache.hasBeenRevalidated(tags, lastModified);
	}
	const _lastModified = await globalThis.tagCache.getLastModified(key, lastModified);
	return _lastModified === -1;
}

async function handleSet(key: string, cacheType: CacheEntryType, body?: Buffer): Promise<InternalResult> {
	debug("set", { key, cacheType });

	let payload: {
		value?: Record<string, unknown>;
	} = {};

	if (body && body.length > 0) {
		try {
			payload = JSON.parse(body.toString("utf-8"));
		} catch {
			return buildErrorResponse("Invalid JSON body", 400);
		}
	}

	if (!payload.value) {
		return buildErrorResponse("Missing 'value' in request body", 400);
	}

	try {
		await globalThis.incrementalCache.set(key, payload.value as CacheValue<CacheEntryType>, cacheType);

		// `writeTags` deduplicates through the OpenNext request context and gives up when there is
		// none. The cache handler runs as its own function, so nothing established a context for us.
		await runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			// Write tags for non-composable and non-nextMode tag caches
			const tagCache = globalThis.tagCache;
			// TODO: fix this horrible typing
			if (tagCache.mode !== "nextMode" && !globalThis.openNextConfig?.dangerous?.disableTagCache) {
				let derivedTags: string[] = [];

				if (cacheType === "cache") {
					const tags = getTagsFromValue(payload.value as CacheValue<"cache">);
					derivedTags = tags;
				} else if (cacheType === "fetch") {
					const fetchValue = payload.value as CacheValue<"fetch">;
					const data = fetchValue.data as Record<string, unknown> | undefined;
					derivedTags = (fetchValue.tags as string[]) ?? (data?.tags as string[]) ?? [];
				} else if (cacheType === "composable") {
					const composableValue = payload.value as CacheValue<"composable">;
					derivedTags = composableValue.tags ?? [];
				}

				if (derivedTags.length > 0) {
					const storedTags = await tagCache.getByPath(key);
					const tagsToWrite = derivedTags.filter((tag) => !storedTags.includes(tag));
					if (tagsToWrite.length > 0) {
						// `1` marks a row that was never revalidated: it can never be greater than a
						// real `lastModified`, so the entry being written is not immediately treated
						// as outdated by the next read.
						await writeTags(
							tagsToWrite.map((tag) => ({
								path: key,
								tag,
								revalidatedAt: 1,
							})),
							tagCache
						);
					}
				}
			}
		});

		return buildJsonResponse({ ok: true }, 200);
	} catch (e) {
		error("Failed to set cache entry", e);
		return buildErrorResponse("Failed to set cache entry", 500);
	}
}

async function handleDelete(key: string): Promise<InternalResult> {
	debug("delete", { key });

	try {
		await globalThis.incrementalCache.delete(key);
		return buildJsonResponse({ ok: true }, 200);
	} catch (e) {
		error("Failed to delete cache entry", e);
		return buildErrorResponse("Failed to delete cache entry", 500);
	}
}

async function handleRevalidateTags(body?: Buffer): Promise<InternalResult> {
	debug("revalidateTags");

	if (!body || body.length === 0) {
		return buildErrorResponse("Missing request body", 400);
	}

	let parsed: { tags?: string[]; durations?: { expire?: number } };
	try {
		parsed = JSON.parse(body.toString("utf-8"));
	} catch {
		return buildErrorResponse("Invalid JSON body", 400);
	}

	const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
	if (tags.length === 0) {
		return buildErrorResponse("Missing 'tags' array in request body", 400);
	}

	const { durations } = parsed;

	try {
		await runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			if (globalThis.tagCache.mode === "nextMode") {
				const paths = (await globalThis.tagCache.getPathsByTags?.(tags)) ?? [];

				const now = Date.now();
				const tagsToWrite = tags.map((tag) => {
					if (durations) {
						return {
							tag,
							stale: now,
							expire: durations.expire !== undefined ? now + durations.expire * 1000 : undefined,
						};
					}
					return { tag, expire: now };
				});

				await writeTags(tagsToWrite);
				if (paths.length > 0) {
					await globalThis.cdnInvalidationHandler.invalidatePaths(
						paths.map((path) => ({
							initialPath: path,
							rawPath: path,
							resolvedRoutes: [
								{
									route: path,
									type: "app",
									isFallback: false,
								},
							],
						}))
					);
				}
				return;
			}

			const now = Date.now();
			for (const tag of tags) {
				debug("revalidateTag", tag);
				const paths = await globalThis.tagCache.getByTag(tag);
				debug("Items", paths);
				const toInsert = paths.map((path) => {
					const baseEntry = { path, tag };
					if (durations) {
						return {
							...baseEntry,
							stale: now,
							expire: durations.expire !== undefined ? now + durations.expire * 1000 : undefined,
						};
					}
					return { ...baseEntry, expire: now };
				});

				if (tag.startsWith(SOFT_TAG_PREFIX)) {
					for (const path of paths) {
						const _tags = await globalThis.tagCache.getByPath(path);
						const hardTags = _tags.filter((t) => !t.startsWith(SOFT_TAG_PREFIX));
						for (const hardTag of hardTags) {
							const _paths = await globalThis.tagCache.getByTag(hardTag);
							debug({ hardTag, _paths });
							toInsert.push(
								..._paths.map((path) => {
									const baseEntry = { path, tag: hardTag };
									if (durations) {
										return {
											...baseEntry,
											stale: now,
											expire: durations.expire !== undefined ? now + durations.expire * 1000 : undefined,
										};
									}
									return { ...baseEntry, expire: now };
								})
							);
						}
					}
				}

				await writeTags(toInsert);

				const uniquePaths = Array.from(
					new Set(toInsert.filter((t) => t.tag.startsWith(SOFT_TAG_PREFIX)).map((t) => `/${t.path}`))
				);
				if (uniquePaths.length > 0) {
					await globalThis.cdnInvalidationHandler.invalidatePaths(
						uniquePaths.map((path) => ({
							initialPath: path,
							rawPath: path,
							resolvedRoutes: [
								{
									route: path,
									type: "app",
									isFallback: false,
								},
							],
						}))
					);
				}
			}
		});

		return buildJsonResponse({ revalidated: tags }, 200);
	} catch (e) {
		error("Failed to revalidate tags", e);
		return buildErrorResponse("Failed to revalidate tags", 500);
	}
}

/////////////////////////////
// Cache GET response builder //
/////////////////////////////

function buildCacheGetResponse(result: WithLastModified<CacheValue<CacheEntryType>>): InternalResult {
	const value = result.value!;

	const headers: Record<string, string | string[]> = {
		"x-opennext-cache-found": "true",
		"Cache-Control": "no-store",
	};

	if (result.lastModified !== undefined) {
		headers["x-opennext-cache-last-modified"] = String(result.lastModified);
	}
	if (result.shouldBypassTagCache) {
		headers["x-opennext-cache-should-bypass"] = "true";
	}

	if ("kind" in value && value.kind === "FETCH") {
		return buildFetchResponse(value as CachedFetchValue, headers);
	}

	if ("type" in value) {
		return buildCachedFileResponse(value as CachedFile, headers);
	}

	return buildComposableResponse(value as StoredComposableCacheEntry, headers);
}

function buildFetchResponse(
	value: CacheValue<"fetch">,
	headers: Record<string, string | string[]>
): InternalResult {
	headers["x-opennext-cache-type"] = "fetch";
	headers["x-opennext-cache-fetch-kind"] = "FETCH";
	headers["x-opennext-cache-fetch-data-url"] = value.data.url;

	if (value.revalidate !== undefined) {
		headers["x-opennext-cache-revalidate"] = String(value.revalidate);
	}

	if (value.data.status !== undefined) {
		headers["x-opennext-cache-fetch-data-status"] = String(value.data.status);
	}
	if (value.data.tags) {
		headers["x-opennext-cache-fetch-data-tags"] = JSON.stringify(value.data.tags);
	}
	if (value.tags) {
		headers["x-opennext-cache-fetch-tags"] = JSON.stringify(value.tags);
	}

	for (const [key, val] of Object.entries(value.data.headers)) {
		headers[`x-opennext-cache-header-${key}`] = val;
	}

	const body = value.data.body;
	return {
		type: "core",
		statusCode: 200,
		body: toReadableStream(body),
		isBase64Encoded: false,
		headers: { ...headers, "Content-Type": "text/plain" },
	};
}

function buildCachedFileResponse(
	value: CacheValue<"cache">,
	headers: Record<string, string | string[]>
): InternalResult {
	headers["x-opennext-cache-type"] = "cache";
	headers["x-opennext-cache-sub-type"] = value.type;

	if (value.revalidate !== undefined) {
		headers["x-opennext-cache-revalidate"] = String(value.revalidate);
	}

	if (value.meta?.status !== undefined) {
		headers["x-opennext-cache-meta-status"] = String(value.meta.status);
	}
	if (value.meta?.postponed !== undefined) {
		headers["x-opennext-cache-meta-postponed"] = value.meta.postponed;
	}
	if (value.meta?.headers) {
		for (const [key, val] of Object.entries(value.meta.headers)) {
			if (val !== undefined) {
				headers[`x-opennext-cache-header-${key}`] = val;
			}
		}
	}

	switch (value.type) {
		case "route": {
			return {
				type: "core",
				statusCode: 200,
				body: toReadableStream(value.body),
				isBase64Encoded: false,
				headers: { ...headers, "Content-Type": "text/plain" },
			};
		}
		case "page": {
			return {
				type: "core",
				statusCode: 200,
				body: toReadableStream(JSON.stringify({ json: value.json, html: value.html })),
				isBase64Encoded: false,
				headers: { ...headers, "Content-Type": "application/json" },
			};
		}
		case "app": {
			return {
				type: "core",
				statusCode: 200,
				body: toReadableStream(
					JSON.stringify({
						html: value.html,
						rsc: value.rsc,
						segmentData: value.segmentData,
					})
				),
				isBase64Encoded: false,
				headers: { ...headers, "Content-Type": "application/json" },
			};
		}
		case "redirect": {
			return {
				type: "core",
				statusCode: 200,
				body: toReadableStream(JSON.stringify(value.props ?? {})),
				isBase64Encoded: false,
				headers: { ...headers, "Content-Type": "application/json" },
			};
		}
	}
}

function buildComposableResponse(
	value: StoredComposableCacheEntry,
	headers: Record<string, string | string[]>
): InternalResult {
	headers["x-opennext-cache-type"] = "composable";
	headers["x-opennext-cache-composable-stale"] = String(value.stale);
	headers["x-opennext-cache-composable-expire"] = String(value.expire);
	headers["x-opennext-cache-composable-timestamp"] = String(value.timestamp);
	headers["x-opennext-cache-composable-revalidate"] = String(value.revalidate);
	headers["x-opennext-cache-composable-tags"] = JSON.stringify(value.tags);

	return {
		type: "core",
		statusCode: 200,
		body: toReadableStream(value.value),
		isBase64Encoded: false,
		headers: { ...headers, "Content-Type": "text/plain" },
	};
}

//////////////////////////
// Response builders  //
//////////////////////////

function buildJsonResponse(data: unknown, statusCode: number): InternalResult {
	const body = JSON.stringify(data);
	return {
		type: "core",
		statusCode,
		body: toReadableStream(body),
		isBase64Encoded: false,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	};
}

function buildErrorResponse(message: string, statusCode: number): InternalResult {
	debug(message, statusCode);
	const body = JSON.stringify({ error: message });
	return {
		type: "core",
		statusCode,
		body: toReadableStream(body),
		isBase64Encoded: false,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	};
}
