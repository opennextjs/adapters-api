import type { Cache } from "@/types/overrides";
import { parseCacheGetResponse } from "@/utils/cache-get";

const CACHE_URL = process.env.OPEN_NEXT_CACHE_URL ?? "";

const fetchCache: Cache = {
	name: "fetch-cache",
	get: async (key, cacheType) => {
		const query: Record<string, string> = {};
		if (cacheType) query.type = cacheType;
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
	set: async (key, value, cacheType) => {
		// The cache type has to be forwarded: incremental caches may key entries on it,
		// writing without it would store the entry where `get` does not look for it.
		const queryString = cacheType ? `?type=${cacheType}` : "";
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}${queryString}`;
		await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ value }),
		});
	},
	delete: async (key) => {
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}`;
		await fetch(url, { method: "DELETE" });
	},
	revalidateTags: async (tags) => {
		await fetch(`${CACHE_URL}/cache/revalidate-tags`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tags }),
		});
	},
};

export default fetchCache;
