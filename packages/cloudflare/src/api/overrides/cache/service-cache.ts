import type { Cache, CacheEntryType } from "@opennextjs/core/types/overrides.js";
import { parseCacheGetResponse } from "@opennextjs/core/utils/cache-get.js";

import { getCloudflareContext } from "../../cloudflare-context.js";

export const NAME = "cf-service-cache";

export const BINDING_NAME = "NEXT_CACHE_SERVICE";

/**
 * The origin is irrelevant: the requests are sent to the service binding, they never hit the network.
 */
const CACHE_ORIGIN = "https://cache.opennext";

/**
 * Returns the cache handler bound to `NEXT_CACHE_SERVICE`.
 *
 * The binding points at the worker itself by default: the cache handler runs in the same worker,
 * behind the `OpenNextCache` named entrypoint. It can be pointed at another worker to run the
 * cache as a service of its own.
 */
function getCacheService(): Service {
	const service = getCloudflareContext().env[BINDING_NAME];

	if (!service) {
		throw new Error(
			`No \`${BINDING_NAME}\` service binding for the OpenNext cache.\n\n` +
				`Add the following to your wrangler configuration:\n\n` +
				`  "services": [\n` +
				`    { "binding": "${BINDING_NAME}", "service": "<your-worker-name>", "entrypoint": "OpenNextCache" }\n` +
				`  ]\n`
		);
	}

	return service;
}

function getCacheUrl(key: string, cacheType?: CacheEntryType, additionalTags?: string[]) {
	const url = new URL(`/cache/${encodeURIComponent(key)}`, CACHE_ORIGIN);

	if (cacheType) {
		url.searchParams.set("type", cacheType);
	}
	if (additionalTags && additionalTags.length > 0) {
		url.searchParams.set("tags", additionalTags.join(","));
	}

	return url.href;
}

/**
 * Rejects unsuccessful cache mutation responses.
 *
 * @param response - The cache handler response.
 * @param operation - The mutation being performed.
 * @return Nothing.
 * @throws When the cache handler returns a non-success status.
 */
function ensureResponseOk(response: Pick<Response, "ok" | "status">, operation: string): void {
	if (!response.ok) {
		throw new Error(`Failed to ${operation}: cache handler returned ${response.status}`);
	}
}

/**
 * Cache client for the cache handler function.
 *
 * It talks to the `OpenNextCache` entrypoint over the service binding, using the HTTP API of
 * the cache handler function.
 */
const serviceCache = {
	name: NAME,

	get: async (key, cacheType, additionalTags) => {
		const response = await getCacheService().fetch(getCacheUrl(key, cacheType, additionalTags));

		const body = await response.text();
		const headers: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});

		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		return parseCacheGetResponse(headers, body) as any;
	},

	set: async (key, value, cacheType, additionalTags) => {
		const response = await getCacheService().fetch(getCacheUrl(key, cacheType, additionalTags), {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ value }),
		});
		ensureResponseOk(response, "set cache entry");
	},

	delete: async (key) => {
		const response = await getCacheService().fetch(getCacheUrl(key), { method: "DELETE" });
		ensureResponseOk(response, "delete cache entry");
	},

	revalidateTags: async (tags, durations) => {
		const response = await getCacheService().fetch(new URL("/cache/revalidate-tags", CACHE_ORIGIN).href, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tags, durations }),
		});
		ensureResponseOk(response, "revalidate cache tags");
	},
} satisfies Cache;

export default serviceCache;
