import type { Transform, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import type { StreamCreator } from "@opennextjs/core/types/open-next.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { withCompressionVary } from "../wrappers/compression.js";

import { convertFromAPIGatewayProxyEventV2 } from "./aws-apigw-v2.js";

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

type StreamingContext = {
	responseStream: Writable & { setContentType(contentType: string): void };
	contentEncoding: string;
};

const converter: Converter = {
	convertFrom: (event) => convertFromAPIGatewayProxyEventV2(event as APIGatewayProxyEventV2),
	convertTo: async (_event, context) => {
		const { responseStream, contentEncoding } = context as StreamingContext;
		const { promise: output, resolve, reject } = Promise.withResolvers<void>();
		const streamCreator: StreamCreator = {
			writeHeaders(prelude) {
				const existingContentEncoding = prelude.headers["content-encoding"];
				const shouldCompress =
					!existingContentEncoding &&
					contentEncoding !== "identity" &&
					!NULL_BODY_STATUSES.has(prelude.statusCode);
				const headers = { ...prelude.headers };
				if (shouldCompress) {
					Object.assign(headers, withCompressionVary({ ...headers, "content-encoding": contentEncoding }));
					delete headers["content-length"];
				} else if (!existingContentEncoding) {
					headers["content-encoding"] = "identity";
				}

				responseStream.setContentType("application/vnd.awslambda.http-integration-response");
				responseStream.write(
					JSON.stringify({
						statusCode: prelude.statusCode,
						cookies: prelude.cookies,
						headers,
					})
				);
				responseStream.write(new Uint8Array(8));

				let writable: Writable = responseStream;
				let completion = finished(responseStream);
				if (shouldCompress) {
					const transform = createCompressionStream(contentEncoding);
					writable = transform;
					completion = pipeline(transform, responseStream);
				}
				void completion.then(resolve, reject);
				return writable;
			},
		};

		return { type: "stream" as const, streamCreator, output };
	},
	name: "aws-streaming",
};

/**
 * Creates the compression transform selected for the Lambda response.
 *
 * @param encoding - The negotiated response content encoding.
 * @returns The corresponding Node.js compression transform.
 * @throws If the encoding is not supported.
 */
function createCompressionStream(encoding: string): Transform {
	switch (encoding) {
		case "br":
			return zlib.createBrotliCompress({
				flush: zlib.constants.BROTLI_OPERATION_FLUSH,
				finishFlush: zlib.constants.BROTLI_OPERATION_FINISH,
			});
		case "gzip":
			return zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
		case "deflate":
			return zlib.createDeflate({ flush: zlib.constants.Z_SYNC_FLUSH });
		default:
			throw new Error(`Unsupported response content encoding: ${encoding}`);
	}
}

export default converter;
