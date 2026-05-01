import { AsyncLocalStorage } from "node:async_hooks";

import type { InternalEvent, InternalResult } from "@/types/open-next";
import type {
	CacheEntryType,
	CacheValue,
	OpenNextHandlerOptions,
} from "@/types/overrides";

import { createGenericHandler } from "../core/createGenericHandler.js";
import { resolveCdnInvalidation, resolveIncrementalCache, resolveTagCache } from "../core/resolve.js";
import { writeTags } from "../utils/cache.js";
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

	globalThis.incrementalCache = await resolveIncrementalCache(
		config.cacheHandler?.incrementalCache ?? config.default?.override?.incrementalCache
	);

	globalThis.tagCache = await resolveTagCache(
		config.cacheHandler?.tagCache ?? config.default?.override?.tagCache
	);

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

		const cacheType: CacheEntryType = query?.type === "fetch" ? "fetch" : "cache";

		switch (method) {
			case "GET":
				return await handleGet(key, cacheType);
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

async function handleGet(key: string, cacheType: CacheEntryType): Promise<InternalResult> {
	debug("get", { key, cacheType });

	try {
		const result = await globalThis.incrementalCache.get(key, cacheType);

		if (!result) {
			return buildJsonResponse({ found: false, value: null }, 200);
		}

		return buildJsonResponse(
			{
				found: true,
				value: result.value ?? null,
				lastModified: result.lastModified,
				shouldBypassTagCache: result.shouldBypassTagCache,
			},
			200
		);
	} catch (e) {
		error("Failed to get cache entry", e);
		return buildErrorResponse("Failed to get cache entry", 500);
	}
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

	let tags: string[];
	try {
		const parsed = JSON.parse(body.toString("utf-8"));
		tags = Array.isArray(parsed.tags) ? parsed.tags : [];
	} catch {
		return buildErrorResponse("Invalid JSON body", 400);
	}

	if (tags.length === 0) {
		return buildErrorResponse("Missing 'tags' array in request body", 400);
	}

	try {
		await runWithOpenNextRequestContext({ isISRRevalidation: false }, async () => {
			if (globalThis.tagCache.mode === "nextMode") {
				const paths = (await globalThis.tagCache.getPathsByTags?.(tags)) ?? [];

				await writeTags(tags);
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

			for (const tag of tags) {
				debug("revalidateTag", tag);
				const paths = await globalThis.tagCache.getByTag(tag);
				debug("Items", paths);
				const toInsert = paths.map((path) => ({
					path,
					tag,
				}));

				if (tag.startsWith(SOFT_TAG_PREFIX)) {
					for (const path of paths) {
						const _tags = await globalThis.tagCache.getByPath(path);
						const hardTags = _tags.filter((t) => !t.startsWith(SOFT_TAG_PREFIX));
						for (const hardTag of hardTags) {
							const _paths = await globalThis.tagCache.getByTag(hardTag);
							debug({ hardTag, _paths });
							toInsert.push(
								..._paths.map((path) => ({
									path,
									tag: hardTag,
								}))
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

////////////////////////
// Response builders  //
////////////////////////

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
