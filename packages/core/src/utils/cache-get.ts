import type { StoredComposableCacheEntry } from "@/types/cache";
import type { CachedFile, CachedFetchValue, WithLastModified } from "@/types/overrides";

type HeadersMap = Record<string, string | string[]>;

type Base = {
	lastModified?: number;
	shouldBypassTagCache?: boolean;
};

function getHeaderValue(headers: HeadersMap, name: string): string | undefined {
	const v = headers[name];
	if (typeof v === "string") return v;
	if (Array.isArray(v) && v.length > 0) return v[0];
	return undefined;
}

function getHeaderNumber(headers: HeadersMap, name: string): number | undefined {
	const v = getHeaderValue(headers, name);
	if (v === undefined) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function collectPrefixedHeaders(headers: HeadersMap, prefix: string): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.startsWith(prefix)) {
			const originalName = key.slice(prefix.length);
			result[originalName] = value;
		}
	}
	return result;
}

export function parseCacheGetResponse(
	headers: HeadersMap,
	bodyText: string
): WithLastModified<
	| (CachedFile & { revalidate?: number | false })
	| (CachedFetchValue & { revalidate?: number | false })
	| (StoredComposableCacheEntry & { revalidate?: number | false })
> | null {
	const found = getHeaderValue(headers, "x-opennext-cache-found");
	if (found !== "true") return null;

	const cacheType = getHeaderValue(headers, "x-opennext-cache-type");
	const lastModified = getHeaderNumber(headers, "x-opennext-cache-last-modified");
	const shouldBypass = getHeaderValue(headers, "x-opennext-cache-should-bypass") === "true";

	const base: Base = {
		...(lastModified !== undefined ? { lastModified } : {}),
		...(shouldBypass ? { shouldBypassTagCache: true as const } : {}),
	};

	if (cacheType === "composable") {
		return reconstructComposable(headers, bodyText, base);
	}

	if (cacheType === "fetch") {
		return reconstructFetch(headers, bodyText, base);
	}

	return reconstructCachedFile(headers, bodyText, base);
}

function reconstructComposable(headers: HeadersMap, bodyText: string, base: Base) {
	const stale = getHeaderNumber(headers, "x-opennext-cache-composable-stale");
	const expire = getHeaderNumber(headers, "x-opennext-cache-composable-expire");
	const timestamp = getHeaderNumber(headers, "x-opennext-cache-composable-timestamp");
	const revalidate = getHeaderNumber(headers, "x-opennext-cache-composable-revalidate");
	const tagsStr = getHeaderValue(headers, "x-opennext-cache-composable-tags");
	const tags = tagsStr ? JSON.parse(tagsStr) : [];

	if (stale === undefined || expire === undefined || timestamp === undefined || revalidate === undefined) {
		return null;
	}

	return {
		value: {
			value: bodyText,
			tags,
			stale,
			expire,
			timestamp,
			revalidate,
		} satisfies StoredComposableCacheEntry,
		...base,
	};
}

function reconstructFetch(headers: HeadersMap, bodyText: string, base: Base) {
	const kind = getHeaderValue(headers, "x-opennext-cache-fetch-kind");
	if (kind !== "FETCH") return null;

	const url = getHeaderValue(headers, "x-opennext-cache-fetch-data-url") ?? "";
	const status = getHeaderNumber(headers, "x-opennext-cache-fetch-data-status");
	const dataTagsStr = getHeaderValue(headers, "x-opennext-cache-fetch-data-tags");
	const dataTags = dataTagsStr ? JSON.parse(dataTagsStr) : undefined;
	const fetchTagsStr = getHeaderValue(headers, "x-opennext-cache-fetch-tags");
	const fetchTags = fetchTagsStr ? JSON.parse(fetchTagsStr) : undefined;
	const revalidate = getHeaderNumber(headers, "x-opennext-cache-revalidate");

	const dataHeaders = collectPrefixedHeaders(headers, "x-opennext-cache-header-") as Record<string, string>;

	const value: CachedFetchValue & { revalidate?: number | false } = {
		kind: "FETCH",
		data: {
			headers: dataHeaders,
			body: bodyText,
			url,
			...(status !== undefined ? { status } : {}),
			...(dataTags !== undefined ? { tags: dataTags } : {}),
		},
		...(fetchTags !== undefined ? { tags: fetchTags } : {}),
		...(revalidate !== undefined ? { revalidate } : {}),
	};

	return { value, ...base };
}

function reconstructCachedFile(headers: HeadersMap, bodyText: string, base: Base) {
	const subType = getHeaderValue(headers, "x-opennext-cache-sub-type");
	const metaStatus = getHeaderNumber(headers, "x-opennext-cache-meta-status");
	const metaPostponed = getHeaderValue(headers, "x-opennext-cache-meta-postponed");
	const revalidate = getHeaderNumber(headers, "x-opennext-cache-revalidate");

	const metaHeaders = collectPrefixedHeaders(headers, "x-opennext-cache-header-");
	const hasMetaHeaders = Object.keys(metaHeaders).length > 0;

	const meta: Record<string, unknown> = {};
	if (metaStatus !== undefined) meta.status = metaStatus;
	if (metaPostponed !== undefined) meta.postponed = metaPostponed;
	if (hasMetaHeaders) meta.headers = metaHeaders;

	const hasMeta = metaStatus !== undefined || metaPostponed !== undefined || hasMetaHeaders;

	// oxlint-disable-next-line @typescript-eslint/no-explicit-any
	const extra: Record<string, any> = {};
	if (hasMeta) extra.meta = meta;
	if (revalidate !== undefined) extra.revalidate = revalidate;

	switch (subType) {
		case "route": {
			return {
				value: { type: "route", body: bodyText, ...extra } satisfies CachedFile,
				...base,
			};
		}
		case "page": {
			const parsed = JSON.parse(bodyText) as { json: object; html: string };
			return {
				value: { type: "page", html: parsed.html, json: parsed.json, ...extra } satisfies CachedFile,
				...base,
			};
		}
		case "app": {
			const parsed = JSON.parse(bodyText) as {
				html: string;
				rsc: string;
				segmentData?: Record<string, string>;
			};
			return {
				value: {
					type: "app",
					html: parsed.html,
					rsc: parsed.rsc,
					...(parsed.segmentData ? { segmentData: parsed.segmentData } : {}),
					...extra,
				} satisfies CachedFile,
				...base,
			};
		}
		case "redirect": {
			const props = JSON.parse(bodyText);
			return {
				value: { type: "redirect", props, ...extra } satisfies CachedFile,
				...base,
			};
		}
		default:
			return null;
	}
}
