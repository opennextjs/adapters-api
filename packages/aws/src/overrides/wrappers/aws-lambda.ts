import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { WarmerEvent, WarmerResponse } from "@opennextjs/core/adapters/warmer-function.js";
import { parseSetCookieHeader } from "@opennextjs/core/http/util.js";
import type { InternalResult, StreamCreator } from "@opennextjs/core/types/open-next.js";
import type { WrapperHandler } from "@opennextjs/core/types/overrides.js";

import type { AwsLambdaEvent, AwsLambdaReturn } from "../../types/aws-lambda.js";

export function formatWarmerResponse(event: WarmerEvent) {
	return new Promise<WarmerResponse>((resolve) => {
		setTimeout(() => {
			resolve({ serverId, type: "warmer" } satisfies WarmerResponse);
		}, event.delay);
	});
}

const handler: WrapperHandler =
	async (handler, converter) =>
	async (event: unknown): Promise<unknown> => {
		const lambdaEvent = event as AwsLambdaEvent;
		// Handle warmer event
		if ("type" in lambdaEvent) {
			return formatWarmerResponse(lambdaEvent);
		}

		const internalEvent = await converter.convertFrom(lambdaEvent);
		const output = await converter.convertTo(lambdaEvent);
		if (output.type === "direct") {
			return output.data(await handler(internalEvent));
		}
		const response = await handler(internalEvent, { streamCreator: output.streamCreator });
		const directResult = await output.data?.(response);
		if (directResult !== undefined) return directResult;
		await streamResponse(response, output.streamCreator);
		return output.output;
	};

export default {
	wrapper: handler,
	name: "aws-lambda",
	supportStreaming: false,
};

/**
 * Streams a returned response body when the handler did not write it directly.
 *
 * @param response - The internal response returned by the handler.
 * @param streamCreator - The converter's platform response stream creator.
 * @returns A promise that resolves after the returned body has been written.
 */
export async function streamResponse(response: InternalResult, streamCreator: StreamCreator): Promise<void> {
	const { "set-cookie": setCookie, ...responseHeaders } = response.headers;
	const headers = Object.fromEntries(
		Object.entries(responseHeaders).map(([key, value]) => [
			key,
			Array.isArray(value) ? value.join(",") : value,
		])
	);
	const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? parseSetCookieHeader(setCookie) : [];
	const stream = streamCreator.writeHeaders({
		statusCode: response.statusCode,
		headers,
		cookies,
		isBase64Encoded: response.isBase64Encoded,
	});
	if (!response.body) {
		stream.end();
		return;
	}
	await pipeline(Readable.fromWeb(response.body), stream);
}
