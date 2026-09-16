import type { ReadableStream } from "node:stream/web";

import { debug } from "@opennextjs/core/adapters/logger.js";
import { convertToQuery } from "@opennextjs/core/core/routing/util.js";
import { parseSetCookieHeader } from "@opennextjs/core/http/util.js";
import {
	extractHostFromHeaders,
	removeUndefinedFromQuery,
} from "@opennextjs/core/overrides/converters/utils.js";
import type { InternalEvent } from "@opennextjs/core/types/open-next.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import { toReadableStream } from "@opennextjs/core/utils/stream.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { createBufferedStreamCreator } from "./response-stream.js";

// Not sure which one is really needed as this is not documented anywhere but server actions redirect are not working without this,
// it causes a 500 error from cloudfront itself with a 'x-amzErrortype: InternalFailure' header
const CloudFrontBlacklistedHeaders = [
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
	/x-amzn-(.*)/,
	/x-edge-(.*)/,
	"x-cache",
	"x-forwarded-proto",
	"x-real-ip",
	"set-cookie",
	"age",
	"via",
];

function normalizeAPIGatewayProxyEventV2Body(event: APIGatewayProxyEventV2): ReadableStream | undefined {
	const { body, isBase64Encoded } = event;
	if (Buffer.isBuffer(body)) {
		return toReadableStream(body);
	}
	if (typeof body === "string") {
		return toReadableStream(body, isBase64Encoded);
	}
	if (typeof body === "object") {
		return toReadableStream(JSON.stringify(body));
	}
	return undefined;
}

function normalizeAPIGatewayProxyEventV2Headers(event: APIGatewayProxyEventV2): Record<string, string> {
	const { headers: rawHeaders, cookies } = event;

	const headers: Record<string, string> = {};

	if (Array.isArray(cookies)) {
		headers.cookie = cookies.join("; ");
	}

	if (rawHeaders) {
		for (const [key, value] of Object.entries(rawHeaders)) {
			headers[key.toLowerCase()] = value!;
		}
	}

	return headers;
}

export async function convertFromAPIGatewayProxyEventV2(
	event: APIGatewayProxyEventV2
): Promise<InternalEvent> {
	const { rawPath, rawQueryString, requestContext } = event;
	const headers = normalizeAPIGatewayProxyEventV2Headers(event);
	return {
		type: "core",
		method: requestContext.http.method,
		rawPath,
		url: `https://${extractHostFromHeaders(headers)}${rawPath}${rawQueryString ? `?${rawQueryString}` : ""}`,
		body: normalizeAPIGatewayProxyEventV2Body(event),
		headers,
		remoteAddress: requestContext.http.sourceIp,
		query: removeUndefinedFromQuery(convertToQuery(rawQueryString)),
		cookies:
			event.cookies?.reduce(
				(acc, cur) => {
					const [key, value] = cur.split("=");
					acc[key] = value;
					return acc;
				},
				{} as Record<string, string>
			) ?? {},
	};
}

function convertToApiGatewayProxyResultV2(
	prelude: { statusCode: number; cookies: string[]; headers: Record<string, string> },
	body: Buffer,
	isBase64Encoded: boolean
): APIGatewayProxyResultV2 {
	const headers: Record<string, string> = {};
	Object.entries(prelude.headers)
		.map(([key, value]) => [key.toLowerCase(), value] as const)
		.filter(
			([key]) =>
				!CloudFrontBlacklistedHeaders.some((header) =>
					typeof header === "string" ? header === key : header.test(key)
				)
		)
		.forEach(([key, value]) => {
			if (value === null || value === undefined) {
				headers[key] = "";
				return;
			}
			headers[key] = Array.isArray(value) ? value.join(", ") : `${value}`;
		});

	const response: APIGatewayProxyResultV2 = {
		statusCode: prelude.statusCode,
		headers,
		cookies:
			prelude.cookies.length > 0
				? prelude.cookies
				: prelude.headers["set-cookie"]
					? parseSetCookieHeader(prelude.headers["set-cookie"])
					: undefined,
		body: body.toString(isBase64Encoded ? "base64" : "utf8"),
		isBase64Encoded,
	};
	debug(response);
	return response;
}

export default {
	convertFrom: (event) => convertFromAPIGatewayProxyEventV2(event as APIGatewayProxyEventV2),
	convertTo: async () => {
		const { streamCreator, output } = createBufferedStreamCreator(convertToApiGatewayProxyResultV2);
		return { type: "stream" as const, streamCreator, output };
	},
	name: "aws-apigw-v2",
} satisfies Converter;
