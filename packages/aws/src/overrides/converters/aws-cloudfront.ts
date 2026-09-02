import type { OutgoingHttpHeader } from "node:http";

import { debug } from "@opennextjs/core/adapters/logger.js";
import { convertToQuery, convertToQueryString } from "@opennextjs/core/core/routing/util.js";
import { parseSetCookieHeader } from "@opennextjs/core/http/util.js";
import { extractHostFromHeaders } from "@opennextjs/core/overrides/converters/utils.js";
import type { InternalEvent, InternalResult, MiddlewareResult } from "@opennextjs/core/types/open-next.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import { toReadableStream } from "@opennextjs/core/utils/stream.js";
import type {
	CloudFrontCustomOrigin,
	CloudFrontHeaders,
	CloudFrontRequest,
	CloudFrontRequestEvent,
	CloudFrontRequestResult,
} from "aws-lambda";

import { createBufferedStreamCreator } from "./response-stream.js";

const cloudfrontBlacklistedHeaders = [
	// Disallowed headers, see: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html#function-restrictions-disallowed-headers
	"connection",
	"expect",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"trailer",
	"upgrade",
	"x-accel-buffering",
	"x-accel-charset",
	"x-accel-limit-rate",
	"x-accel-redirect",
	/x-amz-cf-(.*)/,
	"x-amzn-auth",
	"x-amzn-cf-billing",
	"x-amzn-cf-id",
	"x-amzn-cf-xff",
	"x-amzn-errortype",
	"x-amzn-fle-profile",
	"x-amzn-header-count",
	"x-amzn-header-order",
	"x-amzn-lambda-integration-tag",
	"x-amzn-requestid",
	/x-edge-(.*)/,
	"x-cache",
	"x-forwarded-proto",
	"x-real-ip",
];

// Read-only headers, see: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html#function-restrictions-read-only-headers
// We should only remove these headers when directly responding in lambda@edge, not for the external middleware
const cloudfrontReadOnlyHeaders = [
	"accept-encoding",
	"content-length",
	"if-modified-since",
	"if-none-match",
	"if-range",
	"if-unmodified-since",
	"transfer-encoding",
	"via",
];

function normalizeCloudFrontRequestEventHeaders(rawHeaders: CloudFrontHeaders): Record<string, string> {
	const headers: Record<string, string> = {};

	for (const [key, values] of Object.entries(rawHeaders)) {
		const lowerKey = key.toLowerCase();
		for (const { value } of values) {
			if (value) {
				headers[lowerKey] = value;
			}
		}
	}

	return headers;
}

async function convertFromCloudFrontRequestEvent(event: CloudFrontRequestEvent): Promise<InternalEvent> {
	const { method, uri, querystring, body, headers: cfHeaders, clientIp } = event.Records[0].cf.request;
	const headers = normalizeCloudFrontRequestEventHeaders(cfHeaders);
	return {
		type: "core",
		method,
		rawPath: uri,
		url: `https://${extractHostFromHeaders(headers)}${uri}${querystring ? `?${querystring}` : ""}`,
		body: body?.data ? toReadableStream(body.data, body.encoding === "base64") : undefined,
		headers,
		remoteAddress: clientIp,
		query: convertToQuery(querystring),
		cookies:
			cfHeaders.cookie?.reduce(
				(acc, cur) => {
					const { key = "", value } = cur;
					acc[key] = value;
					return acc;
				},
				{} as Record<string, string>
			) ?? {},
	};
}

function convertToCloudfrontHeaders(headers: Record<string, OutgoingHttpHeader>, directResponse?: boolean) {
	const cloudfrontHeaders: CloudFrontHeaders = {};
	Object.entries(headers)
		.map(([key, value]) => [key.toLowerCase(), value] as const)
		.filter(
			([key]) =>
				!cloudfrontBlacklistedHeaders.some((header) =>
					typeof header === "string" ? header === key : header.test(key)
				) &&
				// Only remove read-only headers when directly responding in lambda@edge
				(directResponse ? !cloudfrontReadOnlyHeaders.includes(key) : true)
		)
		.forEach(([key, value]) => {
			if (key === "set-cookie") {
				cloudfrontHeaders[key] = parseSetCookieHeader(`${value}`).map((cookie) => ({
					key,
					value: cookie,
				}));
				return;
			}

			cloudfrontHeaders[key] = [
				...(cloudfrontHeaders[key] || []),
				...(Array.isArray(value)
					? value.map((v) => ({ key, value: v }))
					: [{ key, value: value.toString() }]),
			];
		});
	return cloudfrontHeaders;
}

async function convertMiddlewareResult(
	result: MiddlewareResult,
	originalRequest: CloudFrontRequestEvent
): Promise<CloudFrontRequestResult> {
	const { method, clientIp, origin } = originalRequest.Records[0].cf.request;
	const responseHeaders = result.internalEvent.headers;

	// Handle external rewrite

	let customOrigin = origin?.custom as CloudFrontCustomOrigin;
	let host = responseHeaders.host ?? responseHeaders.Host;
	if (result.origin) {
		customOrigin = {
			...customOrigin,
			domainName: result.origin.host,
			port: result.origin.port ?? 443,
			protocol: result.origin.protocol ?? "https",
			customHeaders: {},
		};
		host = result.origin.host;
	}

	const response: CloudFrontRequest = {
		clientIp,
		method,
		uri: result.internalEvent.rawPath,
		querystring: convertToQueryString(result.internalEvent.query).replace("?", ""),
		headers: convertToCloudfrontHeaders({
			...responseHeaders,
			host,
		}),
		origin: origin?.custom
			? {
					custom: customOrigin,
				}
			: origin,
	};

	debug("response rewrite", response);

	return response;
}

function convertToCloudFrontRequestResult(
	prelude: { statusCode: number; cookies: string[]; headers: Record<string, string> },
	body: Buffer,
	isBase64Encoded: boolean
): CloudFrontRequestResult {
	const responseHeaders = {
		...prelude.headers,
		...(prelude.cookies.length > 0 ? { "set-cookie": prelude.cookies } : {}),
	};
	const response: CloudFrontRequestResult = {
		status: prelude.statusCode.toString(),
		statusDescription: "OK",
		headers: convertToCloudfrontHeaders(responseHeaders, true),
		bodyEncoding: isBase64Encoded ? "base64" : "text",
		body: body.toString(isBase64Encoded ? "base64" : "utf8"),
	};

	debug(response);
	return response;
}

export default {
	convertFrom: (event) => convertFromCloudFrontRequestEvent(event as CloudFrontRequestEvent),
	convertTo: async (event) => {
		const { streamCreator, output } = createBufferedStreamCreator(convertToCloudFrontRequestResult);
		return {
			type: "stream" as const,
			streamCreator,
			output,
			data: async (result) =>
				result.type === "middleware"
					? convertMiddlewareResult(result, event as CloudFrontRequestEvent)
					: undefined,
		};
	},
	name: "aws-cloudfront",
} satisfies Converter<InternalEvent, InternalResult | MiddlewareResult>;
