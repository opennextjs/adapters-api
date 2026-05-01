import type { CacheHandlerValue, IncrementalCacheContext, IncrementalCacheValue } from "@/types/cache";

import { isBinaryContentType } from "../utils/binary";

import { debug, error, warn } from "./logger";

function isFetchCache(options?: { kindHint?: "app" | "pages" | "fetch"; kind?: "FETCH" }): boolean {
	if (typeof options === "object") {
		return options.kindHint === "fetch" || options.kind === "FETCH";
	}
	return false;
}
// We need to use globalThis client here as this class can be defined at load time in next 12 but client is not available at load time
export default class Cache {
	public async get(
		key: string,
		// fetchCache is for next 13.5 and above, kindHint is for next 14 and above and boolean is for earlier versions
		options?: {
			kindHint?: "app" | "pages" | "fetch";
			tags?: string[];
			softTags?: string[];
			kind?: "FETCH";
		}
	) {
		if (globalThis.openNextConfig?.dangerous?.disableIncrementalCache) {
			return null;
		}

		return isFetchCache(options) ? this.getFetchCache(key) : this.getIncrementalCache(key);
	}

	async getFetchCache(key: string) {
		debug("get fetch cache", { key });
		try {
			const result = await globalThis.cache.get(key, "fetch");

			if (!result?.value) return null;

			return {
				lastModified: result.lastModified ?? Date.now(),
				value: result.value,
			} as CacheHandlerValue;
		} catch (e) {
			// We can usually ignore errors here as they are usually due to cache not being found
			debug("Failed to get fetch cache", e);
			return null;
		}
	}

	async getIncrementalCache(key: string): Promise<CacheHandlerValue | null> {
		try {
			const cachedEntry = await globalThis.cache.get(key, "cache");

			if (!cachedEntry?.value) {
				return null;
			}

			const cacheData = cachedEntry.value;

			const meta = cacheData.meta;
			const _lastModified = cachedEntry.lastModified ?? Date.now();

			const store = globalThis.__openNextAls.getStore();
			if (store) {
				store.lastModified = _lastModified;
			}

			if (cacheData?.type === "route") {
				return {
					lastModified: _lastModified,
					value: {
						kind: "APP_ROUTE",
						body: Buffer.from(
							cacheData.body ?? Buffer.alloc(0),
							isBinaryContentType(String(meta?.headers?.["content-type"])) ? "base64" : "utf8"
						),
						status: meta?.status,
						headers: meta?.headers,
					},
				} as CacheHandlerValue;
			}
			if (cacheData?.type === "page" || cacheData?.type === "app") {
				if (cacheData?.type === "app") {
					const segmentData = new Map<string, Buffer>();
					if (cacheData.segmentData) {
						for (const [segmentPath, segmentContent] of Object.entries(cacheData.segmentData ?? {})) {
							segmentData.set(segmentPath, Buffer.from(segmentContent));
						}
					}
					return {
						lastModified: _lastModified,
						value: {
							kind: "APP_PAGE",
							html: cacheData.html,
							rscData: Buffer.from(cacheData.rsc),
							status: meta?.status,
							headers: meta?.headers,
							postponed: meta?.postponed,
							segmentData,
						},
					} as CacheHandlerValue;
				}
				return {
					lastModified: _lastModified,
					value: {
						kind: "PAGES",
						html: cacheData.html,
						pageData: cacheData.json,
						status: meta?.status,
						headers: meta?.headers,
					},
				} as CacheHandlerValue;
			}
			if (cacheData?.type === "redirect") {
				return {
					lastModified: _lastModified,
					value: {
						kind: "REDIRECT",
						props: cacheData.props,
					},
				} as CacheHandlerValue;
			}
			warn("Unknown cache type", cacheData);
			return null;
		} catch (e) {
			// We can usually ignore errors here as they are usually due to cache not being found
			debug("Failed to get body cache", e);
			return null;
		}
	}

	async set(key: string, data?: IncrementalCacheValue, ctx?: IncrementalCacheContext): Promise<void> {
		if (globalThis.openNextConfig?.dangerous?.disableIncrementalCache) {
			return;
		}
		// This one might not even be necessary anymore
		// Better be safe than sorry
		const detachedPromise = globalThis.__openNextAls.getStore()?.pendingPromiseRunner.withResolvers<void>();
		try {
			if (data === null || data === undefined) {
				await globalThis.cache.delete(key);
			} else {
				const revalidate = this.extractRevalidateForSet(ctx);
				switch (data.kind) {
					case "ROUTE":
					case "APP_ROUTE": {
						const { body, status, headers } = data;
						await globalThis.cache.set(
							key,
							{
								type: "route",
								body: body.toString(isBinaryContentType(String(headers["content-type"])) ? "base64" : "utf8"),
								meta: {
									status,
									headers,
								},
								revalidate,
							},
							"cache"
						);
						break;
					}
					case "PAGE":
					case "PAGES": {
						const { html, pageData, status, headers } = data;
						const isAppPath = typeof pageData === "string";
						if (isAppPath) {
							await globalThis.cache.set(
								key,
								{
									type: "app",
									html,
									rsc: pageData,
									meta: {
										status,
										headers,
									},
									revalidate,
								},
								"cache"
							);
						} else {
							await globalThis.cache.set(
								key,
								{
									type: "page",
									html,
									json: pageData,
									revalidate,
								},
								"cache"
							);
						}
						break;
					}
					case "APP_PAGE": {
						const { html, rscData, headers, status, segmentData, postponed } = data;
						const segmentToWrite: Record<string, string> = {};
						if (segmentData) {
							for (const [segmentPath, segmentContent] of segmentData.entries()) {
								segmentToWrite[segmentPath] = segmentContent.toString("utf8");
							}
						}
						await globalThis.cache.set(
							key,
							{
								type: "app",
								html,
								rsc: rscData.toString("utf8"),
								meta: {
									status,
									headers,
									postponed,
								},
								revalidate,
								segmentData: segmentData ? segmentToWrite : undefined,
							},
							"cache"
						);
						break;
					}
					case "FETCH":
						await globalThis.cache.set(key, data, "fetch");
						break;
					case "REDIRECT":
						await globalThis.cache.set(
							key,
							{
								type: "redirect",
								props: data.props,
								revalidate,
							},
							"cache"
						);
						break;
					case "IMAGE":
						// Not implemented
						break;
				}
			}

			debug("Finished setting cache");
		} catch (e) {
			error("Failed to set cache", e);
		} finally {
			// We need to resolve the promise even if there was an error
			detachedPromise?.resolve();
		}
	}

	public async revalidateTag(tags: string | string[]) {
		const config = globalThis.openNextConfig.dangerous;
		if (config?.disableTagCache || config?.disableIncrementalCache) {
			return;
		}
		const _tags = Array.isArray(tags) ? tags : [tags];
		if (_tags.length === 0) {
			return;
		}

		try {
			await globalThis.cache.revalidateTags(_tags);
		} catch (e) {
			error("Failed to revalidate tag", e);
		}
	}

	private extractRevalidateForSet(ctx?: IncrementalCacheContext): number | false | undefined {
		if (ctx === undefined) {
			return undefined;
		}
		if (typeof ctx === "number" || ctx === false) {
			return ctx;
		}
		if ("revalidate" in ctx) {
			return ctx.revalidate;
		}
		if ("cacheControl" in ctx) {
			return ctx.cacheControl?.revalidate;
		}
		return undefined;
	}
}
