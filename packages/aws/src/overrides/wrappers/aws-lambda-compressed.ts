import type { Transform } from "node:stream";
import zlib from "node:zlib";

import type { StreamCreator } from "@opennextjs/core/types/open-next.js";
import type { WrapperHandler } from "@opennextjs/core/types/overrides.js";

import type { AwsLambdaEvent, AwsLambdaReturn } from "../../types/aws-lambda.js";

import { formatWarmerResponse } from "./aws-lambda.js";

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
		let contentEncoding: string | null = null;
		if (acceptEncoding?.includes("br")) {
			contentEncoding = "br";
		} else if (acceptEncoding?.includes("gzip")) {
			contentEncoding = "gzip";
		} else if (acceptEncoding?.includes("deflate")) {
			contentEncoding = "deflate";
		}

		const response = await handler(internalEvent, {
			streamCreator: withCompression(output.streamCreator, contentEncoding),
		});
		const directResult = await output.data?.(response);
		return directResult ?? output.output;
	};

export default {
	wrapper: handler,
	name: "aws-lambda-compressed",
	supportStreaming: false,
};

function withCompression(streamCreator: StreamCreator, encoding: string | null): StreamCreator {
	if (!encoding) return streamCreator;
	return {
		...streamCreator,
		writeHeaders(prelude) {
			if (prelude.headers["content-encoding"]) {
				return streamCreator.writeHeaders(prelude);
			}
			const target = streamCreator.writeHeaders({
				...prelude,
				headers: { ...prelude.headers, "content-encoding": encoding },
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
			transform.pipe(target);
			return transform;
		},
	};
}
