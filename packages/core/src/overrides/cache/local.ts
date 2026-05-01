import path from "node:path";

import type { InternalEvent, InternalResult } from "@/types/open-next";
import type { Cache } from "@/types/overrides";
import { parseCacheGetResponse } from "@/utils/cache-get";
import { getMonorepoRelativePath } from "@/utils/normalize-path";
import { fromReadableStream } from "@/utils/stream";

let handler: ((event: InternalEvent) => Promise<InternalResult>) | null = null;

async function getHandler() {
	if (!handler) {
		const cacheHandlerPath = path.join(getMonorepoRelativePath(), "cache-function/index.mjs");
		const m = await import(cacheHandlerPath);
		handler = m.handler;
	}
	return handler;
}

const localCache: Cache = {
	name: "local-cache",
	get: async (key, cacheType) => {
		const h = (await getHandler())!;
		const encodedKey = encodeURIComponent(key);
		const url = `https://on/cache/${encodedKey}`;
		const event: InternalEvent = {
			type: "core",
			method: "GET",
			rawPath: `/cache/${encodedKey}`,
			url,
			headers: {},
			query: cacheType ? { type: cacheType } : {},
			cookies: {},
			remoteAddress: "127.0.0.1",
		};
		const result = await h(event);
		const bodyText = await fromReadableStream(result.body);
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		return parseCacheGetResponse(result.headers, bodyText) as any;
	},
	set: async (key, value, _cacheType) => {
		const h = (await getHandler())!;
		const encodedKey = encodeURIComponent(key);
		const url = `https://on/cache/${encodedKey}`;
		const event: InternalEvent = {
			type: "core",
			method: "PUT",
			rawPath: `/cache/${encodedKey}`,
			url,
			headers: { "Content-Type": "application/json" },
			query: {},
			cookies: {},
			remoteAddress: "127.0.0.1",
			body: Buffer.from(JSON.stringify({ value })),
		};
		await h(event);
	},
	delete: async (key) => {
		const h = (await getHandler())!;
		const encodedKey = encodeURIComponent(key);
		const url = `https://on/cache/${encodedKey}`;
		const event: InternalEvent = {
			type: "core",
			method: "DELETE",
			rawPath: `/cache/${encodedKey}`,
			url,
			headers: {},
			query: {},
			cookies: {},
			remoteAddress: "127.0.0.1",
		};
		await h(event);
	},
};

export default localCache;
