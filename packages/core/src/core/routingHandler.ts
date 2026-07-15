import { resolveRoutes, responseToMiddlewareResult } from "@next/routing";

import { BuildId, NextConfig, RoutingConfig } from "@/config/index";
import type {
	InternalEvent,
	InternalResult,
	PartialResult,
	ResolvedRoute,
	RoutingResult,
} from "@/types/open-next";
import type { AssetResolver } from "@/types/overrides";
import { emptyReadableStream } from "@/utils/stream";

import { debug, error } from "../adapters/logger";

import { cacheInterceptor } from "./routing/cacheInterceptor";
import { detectLocale } from "./routing/i18n";
import { shouldInvokeMiddleware } from "./routing/middleware";
import { convertBodyToReadableStream, constructNextUrl, normalizeLocationHeader } from "./routing/util";

export const MIDDLEWARE_HEADER_PREFIX = "x-middleware-response-";
export const MIDDLEWARE_HEADER_PREFIX_LEN = MIDDLEWARE_HEADER_PREFIX.length;
export const INTERNAL_HEADER_PREFIX = "x-opennext-";
export const INTERNAL_HEADER_INITIAL_URL = `${INTERNAL_HEADER_PREFIX}initial-url`;
export const INTERNAL_HEADER_LOCALE = `${INTERNAL_HEADER_PREFIX}locale`;
export const INTERNAL_HEADER_RESOLVED_ROUTES = `${INTERNAL_HEADER_PREFIX}resolved-routes`;
export const INTERNAL_HEADER_REWRITE_STATUS_CODE = `${INTERNAL_HEADER_PREFIX}rewrite-status-code`;
export const INTERNAL_EVENT_REQUEST_ID = `${INTERNAL_HEADER_PREFIX}request-id`;

const geoHeaderToNextHeader = {
	"x-open-next-city": "x-vercel-ip-city",
	"x-open-next-country": "x-vercel-ip-country",
	"x-open-next-region": "x-vercel-ip-country-region",
	"x-open-next-latitude": "x-vercel-ip-latitude",
	"x-open-next-longitude": "x-vercel-ip-longitude",
};

type Middleware = (request: Request) => Response | Promise<Response>;
type MiddlewareLoader = () => Promise<{ default: Middleware }>;

function defaultMiddlewareLoader() {
	// @ts-expect-error - This is bundled with the runtime handler.
	return import("./routing/middleware.mjs");
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};
	headers.forEach((value, key) => {
		if (
			key === "content-encoding" ||
			key === "x-middleware-rewrite" ||
			key === "x-middleware-next" ||
			key === "x-middleware-override-headers"
		) {
			return;
		}
		if (key === "set-cookie") {
			result[key] = result[key]
				? [...(Array.isArray(result[key]) ? result[key] : [result[key]]), value]
				: [value];
			return;
		}
		result[key] = value;
	});
	return result;
}

function applyResponseHeaders(eventOrResult: InternalEvent | InternalResult, headers: Headers): void {
	const isResult = isInternalResult(eventOrResult);
	const keyPrefix = isResult ? "" : MIDDLEWARE_HEADER_PREFIX;
	for (const [key, value] of Object.entries(headersToRecord(headers))) {
		eventOrResult.headers[keyPrefix + key] = value;
	}
}

function toInvocationUrl(
	eventUrl: string,
	pathname: string,
	query: Record<string, string | string[]>
): string {
	const url = new URL(eventUrl);
	url.pathname = pathname;
	url.search = "";
	for (const [key, value] of Object.entries(query)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			url.searchParams.append(key, item);
		}
	}
	return url.toString();
}

function toInternalEvent(
	event: InternalEvent,
	url: string,
	headers: Headers,
	query: Record<string, string | string[]>
): InternalEvent {
	return {
		...event,
		url,
		rawPath: new URL(url).pathname,
		query,
		headers: {
			...event.headers,
			...headersToRecord(headers),
		} as Record<string, string>,
	};
}

function getResolvedRoute(pathname: string | undefined): ResolvedRoute[] {
	if (!pathname) {
		return [];
	}
	const route = RoutingConfig.routeIndex[pathname];
	return route ? [{ route: pathname, ...route }] : [];
}

function createRoutingResult(
	event: InternalEvent,
	resolvedRoutes: ResolvedRoute[],
	options: {
		isExternalRewrite?: boolean;
		rewriteStatusCode?: number;
		initialResponse?: InternalResult;
		initialURL?: string;
	} = {}
): RoutingResult {
	return {
		internalEvent: event,
		isExternalRewrite: options.isExternalRewrite ?? false,
		origin: false,
		isISR: false,
		resolvedRoutes,
		initialURL: options.initialURL ?? event.url,
		locale: NextConfig.i18n ? detectLocale(event, NextConfig.i18n) : undefined,
		rewriteStatusCode: options.rewriteStatusCode,
		initialResponse: options.initialResponse,
	};
}

export default async function routingHandler(
	event: InternalEvent,
	{
		assetResolver,
		middlewareLoader = defaultMiddlewareLoader,
	}: { assetResolver?: AssetResolver; middlewareLoader?: MiddlewareLoader } = {}
): Promise<InternalResult | RoutingResult> {
	try {
		for (const [openNextGeoName, nextGeoName] of Object.entries(geoHeaderToNextHeader)) {
			const value = event.headers[openNextGeoName];
			if (value) {
				event.headers[nextGeoName] = value;
			}
		}

		for (const key of Object.keys(event.headers)) {
			if (key.startsWith(INTERNAL_HEADER_PREFIX) || key.startsWith(MIDDLEWARE_HEADER_PREFIX)) {
				delete event.headers[key];
			}
		}

		let directMiddlewareResult: InternalResult | undefined;
		let middlewareHeaders = new Headers(event.headers);
		const routingResult = await resolveRoutes({
			url: new URL(event.url),
			buildId: RoutingConfig.buildId || BuildId,
			basePath: NextConfig.basePath ?? "",
			i18n: NextConfig.i18n
				? {
						...NextConfig.i18n,
						domains: NextConfig.i18n.domains?.map((domain) => ({
							...domain,
							locales: [...domain.locales],
						})),
					}
				: undefined,
			headers: middlewareHeaders,
			requestBody: (convertBodyToReadableStream(event.method, event.body) ??
				emptyReadableStream()) as unknown as ReadableStream,
			pathnames: RoutingConfig.pathnames,
			routes: RoutingConfig.routes,
			invokeMiddleware: async (context) => {
				middlewareHeaders = context.headers;
				if (!shouldInvokeMiddleware(event)) {
					return { requestHeaders: context.headers };
				}

				const middleware = await middlewareLoader();
				const response = await middleware.default({
					geo: {
						city: decodeURIComponent(event.headers["x-open-next-city"]),
						country: event.headers["x-open-next-country"],
						region: event.headers["x-open-next-region"],
						latitude: event.headers["x-open-next-latitude"],
						longitude: event.headers["x-open-next-longitude"],
					},
					headers: context.headers,
					method: event.method || "GET",
					nextConfig: {
						basePath: NextConfig.basePath,
						i18n: NextConfig.i18n,
						trailingSlash: NextConfig.trailingSlash,
					},
					url: context.url.toString(),
					body: context.requestBody,
				} as unknown as Request);
				const result = responseToMiddlewareResult(response, context.headers, context.url);
				if (result.bodySent) {
					directMiddlewareResult = {
						type: event.type,
						statusCode: response.status,
						headers: headersToRecord(response.headers),
						body: (response.body ?? emptyReadableStream()) as unknown as InternalResult["body"],
						isBase64Encoded: false,
					};
				}
				return result;
			},
		});

		if (routingResult.middlewareResponded && directMiddlewareResult) {
			return directMiddlewareResult;
		}

		const responseHeaders = routingResult.resolvedHeaders ?? new Headers();
		if (routingResult.redirect) {
			return {
				type: event.type,
				statusCode: routingResult.redirect.status,
				headers: {
					...headersToRecord(responseHeaders),
					Location: normalizeLocationHeader(routingResult.redirect.url.toString(), event.url, true),
				},
				body: emptyReadableStream(),
				isBase64Encoded: false,
			};
		}

		const location = responseHeaders.get("location");
		if (location && routingResult.status && routingResult.status >= 300 && routingResult.status < 400) {
			return {
				type: event.type,
				statusCode: routingResult.status,
				headers: headersToRecord(responseHeaders),
				body: emptyReadableStream(),
				isBase64Encoded: false,
			};
		}

		if (routingResult.externalRewrite) {
			const externalEvent = toInternalEvent(
				event,
				routingResult.externalRewrite.toString(),
				middlewareHeaders,
				routingResult.resolvedQuery ?? {}
			);
			applyResponseHeaders(externalEvent, responseHeaders);
			return createRoutingResult(externalEvent, [], {
				isExternalRewrite: true,
				rewriteStatusCode: routingResult.status,
				initialURL: event.url,
			});
		}

		if (!routingResult.invocationTarget || !routingResult.resolvedPathname) {
			const notFoundEvent = {
				...event,
				rawPath: "/404",
				url: constructNextUrl(event.url, "/404"),
				headers: {
					...event.headers,
					"x-middleware-response-cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
				},
			};
			applyResponseHeaders(notFoundEvent, responseHeaders);
			return createRoutingResult(notFoundEvent, [], {
				rewriteStatusCode: routingResult.status,
				initialURL: event.url,
			});
		}

		const invocationUrl = toInvocationUrl(
			event.url,
			routingResult.invocationTarget.pathname,
			routingResult.invocationTarget.query
		);
		const resolvedEvent = {
			...toInternalEvent(
				event,
				invocationUrl,
				middlewareHeaders,
				routingResult.resolvedQuery ?? routingResult.invocationTarget.query
			),
			rewriteStatusCode: routingResult.status,
		};
		const resolvedRoutes = getResolvedRoute(routingResult.resolvedPathname);

		const assetResult = await assetResolver?.maybeGetAssetResult?.(resolvedEvent);
		if (assetResult) {
			applyResponseHeaders(assetResult, responseHeaders);
			return assetResult;
		}

		if (resolvedRoutes.length === 0) {
			const notFoundEvent = {
				...resolvedEvent,
				rawPath: "/404",
				url: constructNextUrl(resolvedEvent.url, "/404"),
				headers: {
					...resolvedEvent.headers,
					"x-middleware-response-cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
				},
			};
			applyResponseHeaders(notFoundEvent, responseHeaders);
			return createRoutingResult(notFoundEvent, [], {
				rewriteStatusCode: routingResult.status,
				initialURL: event.url,
			});
		}

		debug("Attempting cache interception");
		const cacheInterceptionResult = await cacheInterceptor(resolvedEvent);
		if (isInternalResult(cacheInterceptionResult)) {
			applyResponseHeaders(cacheInterceptionResult, responseHeaders);
			return cacheInterceptionResult;
		}
		if (isPartialResult(cacheInterceptionResult)) {
			applyResponseHeaders(cacheInterceptionResult.result, responseHeaders);
			applyResponseHeaders(cacheInterceptionResult.resumeRequest, responseHeaders);
			return createRoutingResult(cacheInterceptionResult.resumeRequest, resolvedRoutes, {
				rewriteStatusCode: routingResult.status,
				initialResponse: cacheInterceptionResult.result,
				initialURL: event.url,
			});
		}

		applyResponseHeaders(cacheInterceptionResult, responseHeaders);
		return createRoutingResult(cacheInterceptionResult, resolvedRoutes, {
			rewriteStatusCode: routingResult.status,
			initialURL: event.url,
		});
	} catch (e) {
		error("Error in routingHandler", e);
		return createRoutingResult(
			{
				type: "core",
				method: "GET",
				rawPath: "/500",
				url: constructNextUrl(event.url, "/500"),
				headers: { ...event.headers },
				query: event.query,
				cookies: event.cookies,
				remoteAddress: event.remoteAddress,
			},
			[],
			{}
		);
	}
}

export function isInternalResult(
	eventOrResult: InternalEvent | InternalResult | PartialResult
): eventOrResult is InternalResult {
	return eventOrResult != null && "statusCode" in eventOrResult;
}

export function isPartialResult(
	eventOrResult: InternalEvent | InternalResult | PartialResult
): eventOrResult is PartialResult {
	return eventOrResult != null && "resumeRequest" in eventOrResult;
}
