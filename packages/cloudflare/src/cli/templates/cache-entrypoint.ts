/**
 * The OpenNext cache handler, exposed as a named entrypoint of the worker.
 *
 * The cache handler function is bundled by `createCacheBundle` as a regular fetch handler. The
 * server and the middleware reach it through the `NEXT_CACHE_SERVICE` binding, which points at
 * this worker by default so that the cache runs in the same worker, and can point at another
 * worker instead.
 *
 * See https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/#named-entrypoints
 */

import { WorkerEntrypoint } from "cloudflare:workers";

// @ts-expect-error: resolved by wrangler build
import { handler } from "../cache-function/index.mjs";

import { runWithCloudflareContext } from "./init.js";

type CacheHandler = (request: Request, env: CloudflareEnv, ctx: ExecutionContext) => Promise<Response>;

export class OpenNextCache extends WorkerEntrypoint<CloudflareEnv> {
	override fetch(request: Request): Promise<Response> {
		return runWithCloudflareContext(this.env, this.ctx, () =>
			(handler as CacheHandler)(request, this.env, this.ctx)
		);
	}
}
