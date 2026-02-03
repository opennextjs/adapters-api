import { AsyncLocalStorage } from "node:async_hooks";
import { IncomingMessage } from "node:http";
import type {
  InternalEvent,
  InternalResult,
  ResolvedRoute,
  RoutingResult,
} from "@/types/open-next";
import type { OpenNextHandlerOptions } from "@/types/overrides";
import { runWithOpenNextRequestContext } from "@/utils/promise";
import { debug, error } from "../adapters/logger";

import { patchAsyncStorage } from "./patchAsyncStorage";
import { adapterHandler } from "./routing/adapterHandler";
import {
  constructNextUrl,
  convertRes,
  createServerResponse,
} from "./routing/util";
import routingHandler, {
	INTERNAL_EVENT_REQUEST_ID,
	INTERNAL_HEADER_REWRITE_STATUS_CODE,
	INTERNAL_HEADER_INITIAL_URL,
	INTERNAL_HEADER_RESOLVED_ROUTES,
	MIDDLEWARE_HEADER_PREFIX,
	MIDDLEWARE_HEADER_PREFIX_LEN,
} from "./routingHandler";

// This is used to identify requests in the cache
globalThis.__openNextAls = new AsyncLocalStorage();

//#override patchAsyncStorage
patchAsyncStorage();
//#endOverride

export async function openNextHandler(
	internalEvent: InternalEvent,
	options?: OpenNextHandlerOptions
): Promise<InternalResult> {
  const initialHeaders = internalEvent.headers;
  // We only use the requestId header if we are using an external middleware
  // This is to ensure that no one can spoof the requestId
  // When using an external middleware, we always assume that headers cannot be spoofed
  const requestId = globalThis.openNextConfig.middleware?.external
    ? internalEvent.headers[INTERNAL_EVENT_REQUEST_ID]
    : Math.random().toString(36);
  // We run everything in the async local storage context so that it is available in the middleware as well as in NextServer
  return runWithOpenNextRequestContext(
    {
      isISRRevalidation: initialHeaders["x-isr"] === "1",
      waitUntil: options?.waitUntil,
      requestId,
    },
    async () => {
      // Disabled for now, we'll need to revisit this later if needed.
      // await globalThis.__next_route_preloader("waitUntil");
      if (initialHeaders["x-forwarded-host"]) {
        initialHeaders.host = initialHeaders["x-forwarded-host"];
      }
      debug("internalEvent", internalEvent);

			// These 3 will get overwritten by the routing handler if not using an external middleware
			const internalHeaders = {
				initialPath: initialHeaders[INTERNAL_HEADER_INITIAL_URL] ?? internalEvent.rawPath,
				resolvedRoutes: initialHeaders[INTERNAL_HEADER_RESOLVED_ROUTES]
					? JSON.parse(initialHeaders[INTERNAL_HEADER_RESOLVED_ROUTES])
					: ([] as ResolvedRoute[]),
				rewriteStatusCode: Number.parseInt(initialHeaders[INTERNAL_HEADER_REWRITE_STATUS_CODE]),
			};

			let routingResult: InternalResult | RoutingResult = {
				internalEvent,
				isExternalRewrite: false,
				origin: false,
				isISR: false,
				initialURL: internalEvent.url,
				...internalHeaders,
			};

			//#override withRouting
			routingResult = await routingHandler(internalEvent, {
				assetResolver: globalThis.assetResolver,
			});
			//#endOverride

			const headers = "type" in routingResult ? routingResult.headers : routingResult.internalEvent.headers;

			const overwrittenResponseHeaders: Record<string, string | string[]> = {};

			for (const [rawKey, value] of Object.entries(headers)) {
				if (!rawKey.startsWith(MIDDLEWARE_HEADER_PREFIX)) {
					continue;
				}
				const key = rawKey.slice(MIDDLEWARE_HEADER_PREFIX_LEN);
				// We skip this header here since it is used by Next internally and we don't want it on the response headers.
				// This header needs to be present in the request headers for processRequest, so cookies().get() from Next will work on initial render.
				if (key !== "x-middleware-set-cookie") {
					overwrittenResponseHeaders[key] = value as string | string[];
				}
				headers[key] = value;
				delete headers[rawKey];
			}

      if (
        "isExternalRewrite" in routingResult &&
        routingResult.isExternalRewrite === true
      ) {
        try {
          routingResult = await globalThis.proxyExternalRequest.proxy(
            routingResult.internalEvent,
          );
        } catch (e) {
          error("External request failed.", e);
          routingResult = {
            internalEvent: {
              type: "core",
              rawPath: "/500",
              method: "GET",
              headers: {},
              url: constructNextUrl(internalEvent.url, "/500"),
              query: {},
              cookies: {},
              remoteAddress: "",
            },
            // On error we need to rewrite to the 500 page which is an internal rewrite
            isExternalRewrite: false,
            isISR: false,
            origin: false,
            initialURL: internalEvent.url,
            resolvedRoutes: [
              { route: "/500", type: "page", isFallback: false },
            ],
          };
        }
      }

			if ("type" in routingResult) {
				// response is used only in the streaming case
				if (options?.streamCreator) {
					const response = createServerResponse(
						{
							internalEvent,
							isExternalRewrite: false,
							isISR: false,
							resolvedRoutes: [],
							origin: false,
							initialURL: internalEvent.url,
						},
						routingResult.headers,
						options.streamCreator
					);
					response.statusCode = routingResult.statusCode;
					response.flushHeaders();
					const [bodyToConsume, bodyToReturn] = routingResult.body.tee();
					for await (const chunk of bodyToConsume) {
						response.write(chunk);
					}
					response.end();
					routingResult.body = bodyToReturn;
				}
				return routingResult;
			}

			const preprocessedEvent = routingResult.internalEvent;
			debug("preprocessedEvent", preprocessedEvent);
			const { search, pathname, hash } = new URL(preprocessedEvent.url);
			const reqProps = {
				method: preprocessedEvent.method,
				url: `${pathname}${search}${hash}`,
				//WORKAROUND: We pass this header to the serverless function to mimic a prefetch request which will not trigger revalidation since we handle revalidation differently
				// There is 3 way we can handle revalidation:
				// 1. We could just let the revalidation go as normal, but due to race conditions the revalidation will be unreliable
				// 2. We could alter the lastModified time of our cache to make next believe that the cache is fresh, but this could cause issues with stale data since the cdn will cache the stale data as if it was fresh
				// 3. OUR CHOICE: We could pass a purpose prefetch header to the serverless function to make next believe that the request is a prefetch request and not trigger revalidation (This could potentially break in the future if next changes the behavior of prefetch requests)
				headers: {
					...headers,
					//#override appendPrefetch
					purpose: "prefetch",
					//#endOverride
				},
				body: preprocessedEvent.body,
				remoteAddress: preprocessedEvent.remoteAddress,
			};

			const mergeHeadersPriority = globalThis.openNextConfig.dangerous?.headersAndCookiesPriority
				? globalThis.openNextConfig.dangerous.headersAndCookiesPriority(preprocessedEvent)
				: "middleware";
			const store = globalThis.__openNextAls.getStore();
			if (store) {
				store.mergeHeadersPriority = mergeHeadersPriority;
			}

      // @ts-expect-error - IncomingMessage constructor expects a Socket, but we're passing a plain object
      // This is a common pattern in OpenNext for mocking requests
      const req = new IncomingMessage(reqProps);
      const res = createServerResponse(
        routingResult,
        overwrittenResponseHeaders,
        options?.streamCreator,
      );
      // It seems that Next.js doesn't set the status code for 404 and 500 anymore for us, we have to do it ourselves
      // TODO: check security wise if it's ok to do that
      if (pathname === "/404") {
        res.statusCode = 404;
      } else if (pathname === "/500") {
        res.statusCode = 500;
      }

			//#override useAdapterHandler
			await adapterHandler(req, res, routingResult, {
				waitUntil: options?.waitUntil,
			});
			//#endOverride

      const {
        statusCode,
        headers: responseHeaders,
        isBase64Encoded,
        body,
      } = convertRes(res);

			const internalResult = {
				type: internalEvent.type,
				statusCode,
				headers: responseHeaders,
				body,
				isBase64Encoded,
			};

			return internalResult;
		}
	);
}
