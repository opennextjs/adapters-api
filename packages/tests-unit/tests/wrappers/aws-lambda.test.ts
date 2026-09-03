import { Readable } from "node:stream";

import converter from "@opennextjs/aws/overrides/converters/aws-apigw-v2.js";
import wrapper from "@opennextjs/aws/overrides/wrappers/aws-lambda.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({}));

describe("aws-lambda wrapper", () => {
	it("streams a body returned by an edge handler into a buffered converter", async () => {
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: {},
			requestContext: { http: { method: "GET", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;
		const wrapped = await wrapper.wrapper(async () => {
			return {
				type: "core",
				statusCode: 201,
				headers: { "content-type": "text/plain", "set-cookie": ["first=1", "second=2"] },
				body: Readable.toWeb(Readable.from("hello")),
				isBase64Encoded: false,
			};
		}, converter);

		const response = (await wrapped(event)) as APIGatewayProxyResultV2;

		expect(response).toMatchObject({
			statusCode: 201,
			body: "hello",
			isBase64Encoded: false,
			cookies: ["first=1", "second=2"],
		});
	});

	it("finalizes a bodyless response", async () => {
		const event = {
			version: "2.0",
			routeKey: "$default",
			rawPath: "/",
			rawQueryString: "",
			headers: {},
			requestContext: { http: { method: "HEAD", sourceIp: "::1" } },
			isBase64Encoded: false,
		} as APIGatewayProxyEventV2;
		const wrapped = await wrapper.wrapper(async () => {
			return {
				type: "core",
				statusCode: 204,
				headers: {},
				isBase64Encoded: false,
			};
		}, converter);

		await expect(wrapped(event)).resolves.toMatchObject({ statusCode: 204, body: "" });
	});
});
