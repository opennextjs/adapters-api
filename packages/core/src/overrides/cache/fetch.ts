import type { Cache } from "@/types/overrides";
import { parseCacheGetResponse } from "@/utils/cache-get";

const CACHE_URL = process.env.OPEN_NEXT_CACHE_URL ?? "";

/**
 * Rejects unsuccessful cache mutation responses.
 *
 * @param response Cache handler response.
 * @param operation Mutation being performed.
 * @throws When the cache handler returns a non-success status.
 */
function ensureResponseOk(response: Pick<Response, "ok" | "status">, operation: string): void {
	if (!response.ok) {
		throw new Error(`Failed to ${operation}: cache handler returned ${response.status}`);
	}
}

const fetchCache: Cache = {
	name: "fetch-cache",
	get: async (key, cacheType, additionalTags) => {
		const query: Record<string, string> = {};
		if (cacheType) query.type = cacheType;
		if (additionalTags && additionalTags.length > 0) query.tags = additionalTags.join(",");
		const queryString = Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : "";
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}${queryString}`;
		const response = await fetch(url, { method: "GET" });
		const bodyText = await response.text();
		const headers: Record<string, string> = {};
		response.headers.forEach((v, k) => {
			headers[k] = v;
		});
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		return parseCacheGetResponse(headers, bodyText) as any;
	},
	set: async (key, value, cacheType, additionalTags) => {
		// The cache type has to be forwarded: incremental caches may key entries on it,
		// writing without it would store the entry where `get` does not look for it.
		const query = new URLSearchParams();
		if (cacheType) query.set("type", cacheType);
		if (additionalTags && additionalTags.length > 0) query.set("tags", additionalTags.join(","));
		const queryString = query.size > 0 ? `?${query.toString()}` : "";
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}${queryString}`;
		const response = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ value }),
		});
		ensureResponseOk(response, "set cache entry");
	},
	delete: async (key) => {
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}`;
		const response = await fetch(url, { method: "DELETE" });
		ensureResponseOk(response, "delete cache entry");
	},
	revalidateTags: async (tags) => {
		const response = await fetch(`${CACHE_URL}/cache/revalidate-tags`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tags }),
		});
		ensureResponseOk(response, "revalidate cache tags");
	},
};

export default fetchCache;
