import type { Cache } from "@/types/overrides";
import { parseCacheGetResponse } from "@/utils/cache-get";

const CACHE_URL = process.env.OPEN_NEXT_CACHE_URL ?? "";

const fetchCache: Cache = {
	name: "fetch-cache",
	get: async (key, cacheType) => {
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}${cacheType ? `?type=${cacheType}` : ""}`;
		const response = await fetch(url, { method: "GET" });
		const bodyText = await response.text();
		const headers: Record<string, string> = {};
		response.headers.forEach((v, k) => {
			headers[k] = v;
		});
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		return parseCacheGetResponse(headers, bodyText) as any;
	},
	set: async (key, value, _cacheType) => {
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}`;
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
	revalidateTags: async (tags, durations) => {
		await fetch(`${CACHE_URL}/cache/revalidate-tags`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tags, durations }),
		});
	},
};

export default fetchCache;
