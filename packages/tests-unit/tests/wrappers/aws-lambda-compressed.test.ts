import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";

import converter from "@opennextjs/aws/overrides/converters/aws-apigw-v2.js";
import wrapper from "@opennextjs/aws/overrides/wrappers/aws-lambda-compressed.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({}));

describe("aws-lambda-compressed wrapper", () => {
	it("returns compressed bodies as base64 and removes the original content length", async () => {
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: { "accept-encoding": "gzip" },
			requestContext: { http: { method: "GET", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;
		const wrapped = await wrapper.wrapper(async () => {
			return {
				type: "core",
				statusCode: 200,
				headers: { "content-type": "text/plain", "content-length": "5" },
				body: Readable.toWeb(Readable.from("hello")),
				isBase64Encoded: false,
			};
		}, converter);

		const response = (await wrapped(event)) as APIGatewayProxyResultV2;

		expect(response.isBase64Encoded).toBe(true);
		expect(response.headers).toEqual({
			"content-type": "text/plain",
			"content-encoding": "gzip",
			vary: "Accept-Encoding",
		});
		expect(gunzipSync(Buffer.from(response.body ?? "", "base64")).toString()).toBe("hello");
	});

	it("finalizes a bodyless response without adding compression", async () => {
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: { "accept-encoding": "gzip" },
			requestContext: { http: { method: "HEAD", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;
		const wrapped = await wrapper.wrapper(async () => {
			return { type: "core", statusCode: 204, headers: {}, isBase64Encoded: false };
		}, converter);

		await expect(wrapped(event)).resolves.toMatchObject({
			statusCode: 204,
			body: "",
			isBase64Encoded: false,
		});
	});
});
