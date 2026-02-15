import type { InternalResult } from "@opennextjs/aws/types/open-next.js";

//@ts-expect-error: Will be resolved by wrangler build
import { handleImageRequest } from "./cloudflare/images.js";
//@ts-expect-error: Will be resolved by wrangler build
import { runWithCloudflareRequestContext } from "./cloudflare/init.js";
//@ts-expect-error: Will be resolved by wrangler build
import { maybeGetSkewProtectionResponse } from "./cloudflare/skew-protection.js";
// @ts-expect-error: Will be resolved by wrangler build
import { handler as middlewareHandler } from "./middleware/handler.mjs";
//@ts-expect-error: Will be resolved by wrangler build
export { DOQueueHandler } from "./.build/durable-objects/queue.js";
//@ts-expect-error: Will be resolved by wrangler build
export { DOShardedTagCache } from "./.build/durable-objects/sharded-tag-cache.js";
//@ts-expect-error: Will be resolved by wrangler build
export { BucketCachePurge } from "./.build/durable-objects/bucket-cache-purge.js";

export default {
	async fetch(request, env, ctx) {
		return runWithCloudflareRequestContext(request, env, ctx, async () => {
			const response = maybeGetSkewProtectionResponse(request);

			if (response) {
				return response;
			}

			const url = new URL(request.url);

			// Serve images in development.
			// Note: "/cdn-cgi/image/..." requests do not reach production workers.
			if (url.pathname.startsWith("/cdn-cgi/image/")) {
				const m = url.pathname.match(/\/cdn-cgi\/image\/.+?\/(?<url>.+)$/);
				if (m === null) {
					return new Response("Not Found!", { status: 404 });
				}
				const imageUrl = m.groups!.url!;
				return imageUrl.match(/^https?:\/\//)
					? fetch(imageUrl, { cf: { cacheEverything: true } })
					: env.ASSETS?.fetch(new URL(`/${imageUrl}`, url));
			}

			// Fallback for the Next default image loader.
			if (
				url.pathname ===
				`${globalThis.__NEXT_BASE_PATH__}/_next/image${globalThis.__TRAILING_SLASH__ ? "/" : ""}`
			) {
				return await handleImageRequest(url, request.headers, env);
			}

			// - `Request`s are handled by the Next server
			const reqOrResp: Response | Request | { initialResponse: InternalResult; request: Request } =
				await middlewareHandler(request, env, ctx);

			if (reqOrResp instanceof Response) {
				return reqOrResp;
			}

			// @ts-expect-error: resolved by wrangler build
			const { handler } = await import("./server-functions/default/handler.mjs");

			//This is PPR response, we need to handle it differently
			// We'll likely change that when we'll make the StreamCreator mandatory.
			if ("initialResponse" in reqOrResp) {
				// We need to create a ReadableStream for the body
				const body = new ReadableStream({
					async start(controller) {
						const initialBodyReader = reqOrResp.initialResponse.body?.getReader();
						if (initialBodyReader) {
							while (true) {
								const { done, value } = await initialBodyReader.read();
								if (done) {
									break;
								}
								controller.enqueue(value);
							}
						}
						const resp: Response = await handler(reqOrResp.request, env, ctx, request.signal);
						const reader = resp.body?.getReader();
						if (!reader) {
							controller.close();
							return;
						}
						while (true) {
							const { done, value } = await reader.read();
							if (done) {
								break;
							}
							controller.enqueue(value);
						}
						controller.close();
					},
				});

				const headers = new Headers();
				for (const [key, value] of Object.entries(reqOrResp.initialResponse.headers)) {
					if (Array.isArray(value)) {
						for (const v of value) {
							headers.append(key, v);
						}
					} else {
						headers.set(key, value);
					}
				}

				headers.set("content-encoding", "identity"); // To fix PPR locally

				return new Response(body, {
					status: reqOrResp.initialResponse.statusCode,
					headers: headers,
				});
			}

			return handler(reqOrResp, env, ctx, request.signal);
		});
	},
} satisfies ExportedHandler<CloudflareEnv>;
