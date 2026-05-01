import type { Cache } from "@/types/overrides";

const CACHE_URL = process.env.OPEN_NEXT_CACHE_URL ?? "";

const fetchCache: Cache = {
	name: "fetch-cache",
	get: async (key, cacheType) => {
		const url = `${CACHE_URL}/cache/${encodeURIComponent(key)}${cacheType ? `?type=${cacheType}` : ""}`;
		const response = await fetch(url, { method: "GET" });
		if (!response.ok) {
			return null;
		}
		const data = (await response.json()) as {
			found: boolean;
			value?: unknown;
			lastModified?: number;
			shouldBypassTagCache?: boolean;
		};
		if (!data.found) {
			return null;
		}
		const result: Record<string, unknown> = {
			value: data.value,
			lastModified: data.lastModified,
			shouldBypassTagCache: data.shouldBypassTagCache,
		};
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		return result as any;
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
};

export default fetchCache;
