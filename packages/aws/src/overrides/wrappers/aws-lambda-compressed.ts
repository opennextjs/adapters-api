import type { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import type { StreamCreator } from "@opennextjs/core/types/open-next.js";
import type { WrapperHandler } from "@opennextjs/core/types/overrides.js";

import type { AwsLambdaEvent, AwsLambdaReturn } from "../../types/aws-lambda.js";

import { formatWarmerResponse, streamResponse } from "./aws-lambda.js";
import { selectCompressionEncoding, withCompressionVary } from "./compression.js";

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

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

		const acceptEncoding =
			internalEvent.headers["accept-encoding"] ?? internalEvent.headers["Accept-Encoding"] ?? "";
		const contentEncoding = selectCompressionEncoding(acceptEncoding);

		const response = await handler(internalEvent, {
			streamCreator: withCompression(output.streamCreator, contentEncoding),
		});
		const directResult = await output.data?.(response);
		if (directResult !== undefined) return directResult;
		await streamResponse(response, withCompression(output.streamCreator, contentEncoding));
		return output.output;
	};

export default {
	wrapper: handler,
	name: "aws-lambda-compressed",
	supportStreaming: false,
};

/**
 * Adds negotiated compression to a response stream creator.
 *
 * @param streamCreator - The underlying platform response stream creator.
 * @param encoding - The negotiated response content encoding, if any.
 * @returns A stream creator that compresses response bodies when required.
 */
function withCompression(streamCreator: StreamCreator, encoding: string | null): StreamCreator {
	if (!encoding) return streamCreator;
	return {
		...streamCreator,
		writeHeaders(prelude) {
			if (prelude.headers["content-encoding"] || NULL_BODY_STATUSES.has(prelude.statusCode)) {
				return streamCreator.writeHeaders(prelude);
			}
			const { "content-length": _contentLength, ...headers } = prelude.headers;
			const target = streamCreator.writeHeaders({
				...prelude,
				headers: withCompressionVary({ ...headers, "content-encoding": encoding }),
				isBase64Encoded: true,
			});
			let transform: Transform;

			switch (encoding) {
				case "br":
					const quality = Number(process.env.BROTLI_QUALITY);
					transform = zlib.createBrotliCompress({
						params: {
							// This is a compromise between speed and compression ratio.
							// The default one will most likely timeout an AWS Lambda with default configuration on large bodies (>6mb).
							// Therefore we set it to 6, which is a good compromise.
							[zlib.constants.BROTLI_PARAM_QUALITY]: Number.isNaN(quality) ? 6 : quality,
						},
					});
					break;
				case "gzip":
					transform = zlib.createGzip();
					break;
				case "deflate":
					transform = zlib.createDeflate();
					break;
				default:
					return target;
			}
			void pipeline(transform, target).catch(() => undefined);
			return transform;
		},
	};
}
