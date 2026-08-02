import { Buffer } from "node:buffer";
import { Writable } from "node:stream";

import cookieParser from "cookie";

import { parseSetCookieHeader } from "@/http/util";
import type { InternalEvent, InternalResult, MiddlewareResult, StreamCreator } from "@/types/open-next";
import type { Converter } from "@/types/overrides";

import { getQueryFromSearchParams } from "./utils.js";

declare global {
	// Makes convertTo returns the request instead of fetching it.
	var __dangerous_ON_edge_converter_returns_request: boolean | undefined;
}

// https://fetch.spec.whatwg.org/#statuses
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const converter: Converter<InternalEvent, InternalResult | MiddlewareResult> = {
	convertFrom: async (event: unknown) => {
		const request = event as Request;
		const url = new URL(request.url);

		const searchParams = url.searchParams;
		const query = getQueryFromSearchParams(searchParams);
		const headers: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			headers[key] = value;
		});
		const rawPath = url.pathname;
		const method = request.method;
		const shouldHaveBody = method !== "GET" && method !== "HEAD";

		// Only read body for methods that should have one
		const body = shouldHaveBody ? Buffer.from(await request.arrayBuffer()) : undefined;

		const cookieHeader = request.headers.get("cookie");
		const cookies = cookieHeader ? (cookieParser.parse(cookieHeader) as Record<string, string>) : {};

		return {
			type: "core",
			method,
			rawPath,
			url: request.url,
			body,
			headers,
			remoteAddress: request.headers.get("x-forwarded-for") ?? "::1",
			query,
			cookies,
		};
	},
	convertTo: async (event, context) => {
		const request = event as Request;
		const url = new URL(request.url);
		const { promise: output, resolve: resolveOutput } = Promise.withResolvers<Response>();
		const abortSignal = (context as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
		// Not every handler streams its response: the external middleware handler returns the
		// result directly. We track whether the stream was used to know which one to return.
		let isStreamed = false;
		const streamCreator: StreamCreator = {
			writeHeaders(prelude) {
				isStreamed = true;
				const responseHeaders = new Headers(prelude.headers);
				for (const cookie of prelude.cookies) {
					responseHeaders.append("Set-Cookie", cookie);
				}

				// TODO(vicb): this is a workaround to make PPR work with `wrangler dev`
				// See https://github.com/cloudflare/workers-sdk/issues/8004
				if (url.hostname === "localhost") {
					responseHeaders.set("Content-Encoding", "identity");
				}

				if (NULL_BODY_STATUSES.has(prelude.statusCode)) {
					resolveOutput(new Response(null, { status: prelude.statusCode, headers: responseHeaders }));
					return new Writable({
						write(_chunk, _encoding, callback) {
							callback();
						},
					});
				}

				let controller: ReadableStreamDefaultController<Uint8Array>;
				const readable = new ReadableStream({
					start(value) {
						controller = value;
					},
				});
				resolveOutput(new Response(readable, { status: prelude.statusCode, headers: responseHeaders }));

				return new Writable({
					write(chunk, _encoding, callback) {
						try {
							controller.enqueue(chunk);
							callback();
						} catch (error: unknown) {
							callback(error instanceof Error ? error : new Error(String(error)));
						}
					},
					final(callback) {
						controller.close();
						callback();
					},
					destroy(error, callback) {
						if (error) {
							controller.error(error);
						} else {
							try {
								controller.close();
							} catch {
								// Ignore an already closed stream.
							}
						}
						callback(error);
					},
				});
			},
			abortSignal,
		};

		return {
			type: "stream",
			streamCreator,
			output,
			data: async (result) => {
				if ("internalEvent" in result) {
					return convertMiddlewareResult(result);
				}
				// When the handler streamed the response, `output` already holds it.
				return isStreamed ? undefined : convertInternalResult(result);
			},
		};
	},
	name: "edge",
};

function convertInternalResult(result: InternalResult): Response {
	const headers = new Headers();
	for (const [key, value] of Object.entries(result.headers)) {
		if (key === "set-cookie" && typeof value === "string") {
			// If the value is a string, we need to parse it into an array
			// This is the case for middleware direct result
			for (const cookie of parseSetCookieHeader(value)) {
				headers.append(key, cookie);
			}
			continue;
		}
		if (Array.isArray(value)) {
			for (const v of value) {
				headers.append(key, v);
			}
		} else {
			headers.set(key, value);
		}
	}

	// We should not return a body for statusCode's that doesn't allow bodies
	const body = NULL_BODY_STATUSES.has(result.statusCode)
		? null
		: ((result.body ?? null) as ReadableStream | null);

	return new Response(body, {
		status: result.statusCode,
		headers,
	});
}

async function convertMiddlewareResult(
	result: MiddlewareResult
): Promise<Response | Request | { initialResponse: InternalResult; request: Request }> {
	const request = new Request(result.internalEvent.url, {
		body: result.internalEvent.body as BodyInit | undefined,
		method: result.internalEvent.method,
		headers: {
			...result.internalEvent.headers,
			"x-forwarded-host": result.internalEvent.headers.host,
		},
	});

	if (globalThis.__dangerous_ON_edge_converter_returns_request === true) {
		if (result.initialResponse) {
			return {
				initialResponse: result.initialResponse,
				request,
			};
		}
		return request;
	}

	const cfCache =
		(result.isISR || result.internalEvent.rawPath.startsWith("/_next/image")) &&
		process.env.DISABLE_CACHE !== "true"
			? { cacheEverything: true }
			: {};

	//TODO: we need to handle the PPR case here as well.
	// We'll revisit this when we'll look at making StreamCreator mandatory.
	return fetch(request, {
		// This is a hack to make sure that the response is cached by Cloudflare
		// See https://developers.cloudflare.com/workers/examples/cache-using-fetch/#caching-html-resources
		// @ts-expect-error - This is a Cloudflare specific option
		cf: cfCache,
	});
}

export default converter;
