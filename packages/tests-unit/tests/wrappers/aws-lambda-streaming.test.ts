import { Writable } from "node:stream";

import converter from "@opennextjs/aws/overrides/converters/aws-streaming.js";
import wrapper from "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({}));

describe("aws-lambda-streaming wrapper", () => {
	it("waits for the Lambda response stream to finish", async () => {
		let responseFinished = false;
		const responseStream = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
			final(callback) {
				setTimeout(() => {
					responseFinished = true;
					callback();
				}, 10);
			},
		}) as Writable & { setContentType: (contentType: string) => void };
		responseStream.setContentType = vi.fn();
		const previousAwsLambda = globalThis.awslambda;
		globalThis.awslambda = {
			streamifyResponse: (streamingHandler) => streamingHandler,
			HttpResponseStream: previousAwsLambda?.HttpResponseStream,
		};
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: {},
			requestContext: { http: { method: "GET", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;

		try {
			const wrapped = await wrapper.wrapper(async (_internalEvent, options) => {
				const stream = options?.streamCreator?.writeHeaders({
					statusCode: 200,
					cookies: [],
					headers: { "content-type": "text/plain" },
				});
				stream?.end("hello");
				return { type: "core", statusCode: 200, headers: {}, isBase64Encoded: false };
			}, converter);

			await wrapped(event, responseStream, { callbackWaitsForEmptyEventLoop: true });
			expect(responseFinished).toBe(true);
		} finally {
			globalThis.awslambda = previousAwsLambda;
		}
	});

	it("finalizes a bodyless response returned by an edge handler", async () => {
		let responseFinished = false;
		const responseStream = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
			final(callback) {
				responseFinished = true;
				callback();
			},
		}) as Writable & { setContentType: (contentType: string) => void };
		responseStream.setContentType = vi.fn();
		const previousAwsLambda = globalThis.awslambda;
		const previousEdgeRuntime = globalThis.isEdgeRuntime;
		globalThis.awslambda = {
			streamifyResponse: (streamingHandler) => streamingHandler,
			HttpResponseStream: previousAwsLambda?.HttpResponseStream,
		};
		globalThis.isEdgeRuntime = true;
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: {},
			requestContext: { http: { method: "HEAD", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;

		try {
			const wrapped = await wrapper.wrapper(async () => {
				return { type: "core", statusCode: 204, headers: {}, isBase64Encoded: false };
			}, converter);

			await wrapped(event, responseStream, { callbackWaitsForEmptyEventLoop: true });
			expect(responseFinished).toBe(true);
		} finally {
			globalThis.awslambda = previousAwsLambda;
			globalThis.isEdgeRuntime = previousEdgeRuntime;
		}
	});
});
