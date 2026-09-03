import { type MiddlewareResult, resolveRoutes, responseToMiddlewareResult } from "@next/routing";

import { BuildId, NextConfig, RoutingConfig } from "@/config/index";
import type {
	InternalEvent,
	InternalResult,
	PartialResult,
	ResolvedRoute,
	RoutingResult,
} from "@/types/open-next";
import type { AssetResolver } from "@/types/overrides";
import { emptyReadableStream, toReadableStream } from "@/utils/stream";

import { debug, error } from "../adapters/logger";
import { getQueryFromSearchParams } from "../overrides/converters/utils.js";

import { cacheInterceptor } from "./routing/cacheInterceptor";
import { detectLocale } from "./routing/i18n";
import { getMiddlewareMatchPath, shouldInvokeMiddleware } from "./routing/middleware";
import { resolvePriorityRedirect, splitPriorityRoutes } from "./routing/priorityRoutes";
import { convertBodyToReadableStream, constructNextUrl, normalizeLocationHeader } from "./routing/util";

export const MIDDLEWARE_HEADER_PREFIX = "x-middleware-response-";
export const MIDDLEWARE_HEADER_PREFIX_LEN = MIDDLEWARE_HEADER_PREFIX.length;
export const INTERNAL_HEADER_PREFIX = "x-opennext-";
export const INTERNAL_HEADER_INITIAL_URL = `${INTERNAL_HEADER_PREFIX}initial-url`;
export const INTERNAL_HEADER_LOCALE = `${INTERNAL_HEADER_PREFIX}locale`;
export const INTERNAL_HEADER_RESOLVED_ROUTES = `${INTERNAL_HEADER_PREFIX}resolved-routes`;
export const INTERNAL_HEADER_REWRITE_STATUS_CODE = `${INTERNAL_HEADER_PREFIX}rewrite-status-code`;
export const INTERNAL_EVENT_REQUEST_ID = `${INTERNAL_HEADER_PREFIX}request-id`;

const { priorityRoutes, resolverRoutes } = /* @__PURE__ */ splitPriorityRoutes(RoutingConfig.routes);

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
	return import("./middleware.mjs");
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

/**
 * Converts the headers of the routed request to the record the middleware expects.
 *
 * Next builds the middleware `Request` from `Object.entries(request.headers)`, which yields nothing
 * for a `Headers` instance - the middleware would see a request without a single header, and the
 * headers it forwards with `NextResponse.next({ request })` would drop every one of them.
 */
function headersToRequestRecord(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
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

/**
 * Middleware that builds a destination from a missing `host` header - i.e.
 * `new URL(path, `${protocol}://${host}`)` - ends up with a literal `null` origin
 * (`https://null/path`). Such a destination would be treated as external and fetched
 * from the `null` hostname, so we restore the origin of the incoming request instead.
 */
function restoreNullOrigin(result: MiddlewareResult, requestUrl: URL): void {
	const restore = (url: URL): boolean => {
		if (url.hostname !== "null") {
			return false;
		}
		url.protocol = requestUrl.protocol;
		url.host = requestUrl.host;
		return true;
	};

	if (result.rewrite) {
		restore(result.rewrite);
	}
	if (result.redirect && restore(result.redirect.url)) {
		// The `location` header has already been derived from the redirect url.
		const location = result.redirect.url.toString();
		result.responseHeaders?.set("location", location);
		result.requestHeaders?.set("location", location);
	}
}

function getResolvedRoute(pathname: string | undefined): ResolvedRoute[] {
	if (!pathname) {
		return [];
	}
	// When `trailingSlash` is enabled the resolver matches - and reports - the trailing slash variant
	// of the pathname. The index is keyed by the pathname itself, which never has a trailing slash.
	const indexKey = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	const indexedRoute = RoutingConfig.routeIndex[indexKey];
	if (!indexedRoute) {
		return [];
	}
	// A prerendered pathname is served by the route that generated it, not by itself.
	const { route = indexKey, ...routeMetadata } = indexedRoute;
	return [{ route, ...routeMetadata }];
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
		// The route is only served from the cache when it is prerendered. Routes that could not be
		// resolved - external rewrites, 404s - are never ISR.
		isISR: resolvedRoutes.some((route) => route.isISR),
		resolvedRoutes,
		initialURL: options.initialURL ?? event.url,
		locale: NextConfig.i18n ? detectLocale(event, NextConfig.i18n) : undefined,
		rewriteStatusCode: options.rewriteStatusCode,
		initialResponse: options.initialResponse,
	};
}

/**
 * Resolves an incoming request to an OpenNext route or direct response.
 *
 * @param event The normalized provider request.
 * @param options Optional asset and middleware loaders.
 * @returns The direct response or routing metadata for the selected handler.
 */
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

		const requestUrl = new URL(event.url);
		const priorityRedirect = resolvePriorityRedirect(priorityRoutes, requestUrl, new Headers(event.headers));
		if (priorityRedirect) {
			return {
				type: event.type,
				statusCode: priorityRedirect.status,
				headers: headersToRecord(priorityRedirect.headers),
				body: emptyReadableStream(),
				isBase64Encoded: false,
			};
		}

		let directMiddlewareResult: InternalResult | undefined;
		let middlewareRewriteStatusCode: number | undefined;
		let middlewareHeaders = new Headers(event.headers);
		let forwardedBody = event.body;
		const cancelForwardedBody = (): void => {
			if (forwardedBody !== event.body) {
				void forwardedBody?.cancel().catch(() => {});
			}
		};
		const buildId = RoutingConfig.buildId || BuildId;
		const basePath = NextConfig.basePath ?? "";
		const dataPrefix = `${basePath}/_next/data/`;
		if (
			requestUrl.pathname.startsWith(dataPrefix) &&
			!requestUrl.pathname.startsWith(`${dataPrefix}${buildId}/`)
		) {
			return {
				type: event.type,
				statusCode: 404,
				body: toReadableStream("{}"),
				headers: { "content-type": "application/json" },
				isBase64Encoded: false,
			};
		}
		const routingResult = await resolveRoutes({
			url: requestUrl,
			buildId,
			basePath,
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
			//@ts-expect-error
			requestBody: convertBodyToReadableStream(event.method, event.body),
			pathnames: RoutingConfig.pathnames,
			routes: resolverRoutes,
			invokeMiddleware: async (context) => {
				middlewareHeaders = context.headers;
				// The matchers must be tested against the pathname resolved by the router - the locale has
				// been applied and rewrites matching before the middleware have run - and not against the
				// path of the incoming request.
				const matchPath = getMiddlewareMatchPath(context.url.pathname, buildId, basePath);
				if (!shouldInvokeMiddleware(event, matchPath)) {
					return { requestHeaders: context.headers };
				}

				// The middleware runs on the user visible pathname, so a `_next/data` request has to be
				// invoked on the page it carries - the middleware has no route for the data pathname.
				const middlewareUrl = new URL(context.url);
				middlewareUrl.pathname = matchPath;
				const [bodyForMiddleware, bodyForForward] = context.requestBody?.tee() ?? [undefined, undefined];
				forwardedBody = bodyForForward as InternalEvent["body"];

				const middleware = await middlewareLoader();
				const encodedCity = event.headers["x-open-next-city"];
				const response = await middleware.default({
					geo: {
						city: encodedCity === undefined ? undefined : decodeURIComponent(encodedCity),
						country: event.headers["x-open-next-country"],
						region: event.headers["x-open-next-region"],
						latitude: event.headers["x-open-next-latitude"],
						longitude: event.headers["x-open-next-longitude"],
					},
					headers: headersToRequestRecord(context.headers),
					method: event.method || "GET",
					nextConfig: {
						basePath: NextConfig.basePath,
						i18n: NextConfig.i18n,
						trailingSlash: NextConfig.trailingSlash,
					},
					url: middlewareUrl.toString(),
					body: bodyForMiddleware,
				} as unknown as Request);
				const result = responseToMiddlewareResult(response, context.headers, context.url);
				restoreNullOrigin(result, context.url);
				// The resolver has no notion of the status of a rewrite, but `NextResponse.rewrite(url,
				// { status })` serves the destination with that status - it has to be carried over here.
				if (result.rewrite && response.status !== 200) {
					middlewareRewriteStatusCode = response.status;
				}
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
			cancelForwardedBody();
			return directMiddlewareResult;
		}

		const responseHeaders = routingResult.resolvedHeaders ?? new Headers();
		const rewriteStatusCode = routingResult.status ?? middlewareRewriteStatusCode;
		if (routingResult.redirect) {
			// The resolver already set a `location` from the matched route headers. It must be replaced
			// - and not merely added to the record - so that the response has a single redirect target.
			responseHeaders.set(
				"location",
				normalizeLocationHeader(routingResult.redirect.url.toString(), event.url, true)
			);
			cancelForwardedBody();
			return {
				type: event.type,
				statusCode: routingResult.redirect.status,
				headers: headersToRecord(responseHeaders),
				body: emptyReadableStream(),
				isBase64Encoded: false,
			};
		}

		const location = responseHeaders.get("location");
		if (location && routingResult.status && routingResult.status >= 300 && routingResult.status < 400) {
			cancelForwardedBody();
			return {
				type: event.type,
				statusCode: routingResult.status,
				headers: headersToRecord(responseHeaders),
				body: emptyReadableStream(),
				isBase64Encoded: false,
			};
		}

		if (routingResult.externalRewrite) {
			const externalQuery = {
				...event.query,
				...(routingResult.resolvedQuery ??
					getQueryFromSearchParams(routingResult.externalRewrite.searchParams)),
			};
			const externalUrl = toInvocationUrl(
				routingResult.externalRewrite.toString(),
				routingResult.externalRewrite.pathname,
				externalQuery
			);
			const externalEvent = {
				...toInternalEvent(event, externalUrl, middlewareHeaders, externalQuery),
				body: forwardedBody,
			};
			applyResponseHeaders(externalEvent, responseHeaders);
			return createRoutingResult(externalEvent, [], {
				isExternalRewrite: true,
				rewriteStatusCode,
				initialURL: event.url,
			});
		}

		if (!routingResult.invocationTarget || !routingResult.resolvedPathname) {
			const notFoundEvent = {
				...event,
				body: forwardedBody,
				rawPath: "/404",
				url: constructNextUrl(event.url, "/404"),
				headers: {
					...event.headers,
					"x-middleware-response-cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
				},
			};
			applyResponseHeaders(notFoundEvent, responseHeaders);
			return createRoutingResult(notFoundEvent, [], {
				rewriteStatusCode,
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
			body: forwardedBody,
			rewriteStatusCode,
		};
		const resolvedRoutes = getResolvedRoute(routingResult.resolvedPathname);

		const assetResult = await assetResolver?.maybeGetAssetResult?.(resolvedEvent);
		if (assetResult) {
			cancelForwardedBody();
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
				rewriteStatusCode,
				initialURL: event.url,
			});
		}

		debug("Attempting cache interception");
		const cacheInterceptionResult = await cacheInterceptor(resolvedEvent);
		if (isInternalResult(cacheInterceptionResult)) {
			cancelForwardedBody();
			applyResponseHeaders(cacheInterceptionResult, responseHeaders);
			return cacheInterceptionResult;
		}
		if (isPartialResult(cacheInterceptionResult)) {
			applyResponseHeaders(cacheInterceptionResult.result, responseHeaders);
			applyResponseHeaders(cacheInterceptionResult.resumeRequest, responseHeaders);
			return createRoutingResult(cacheInterceptionResult.resumeRequest, resolvedRoutes, {
				rewriteStatusCode,
				initialResponse: cacheInterceptionResult.result,
				initialURL: event.url,
			});
		}

		applyResponseHeaders(cacheInterceptionResult, responseHeaders);
		return createRoutingResult(cacheInterceptionResult, resolvedRoutes, {
			rewriteStatusCode,
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
