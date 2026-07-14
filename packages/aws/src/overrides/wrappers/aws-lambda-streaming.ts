import { Readable, type Writable } from "node:stream";
import zlib from "node:zlib";

import { error } from "@opennextjs/core/adapters/logger.js";
import type { WarmerEvent, WarmerResponse } from "@opennextjs/core/adapters/warmer-function.js";
import type { Wrapper, WrapperHandler } from "@opennextjs/core/types/overrides.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

type AwsLambdaEvent = APIGatewayProxyEventV2 | WarmerEvent;

type AwsLambdaReturn = void;

function formatWarmerResponse(event: WarmerEvent) {
	const result = new Promise<WarmerResponse>((resolve) => {
		setTimeout(() => {
			resolve({ serverId, type: "warmer" } satisfies WarmerResponse);
		}, event.delay);
	});
	return result;
}

const handler: WrapperHandler = async (handler, converter) =>
	awslambda.streamifyResponse(
		async (event: AwsLambdaEvent, responseStream, context): Promise<AwsLambdaReturn> => {
			context.callbackWaitsForEmptyEventLoop = false;
			if ("type" in event) {
				const result = await formatWarmerResponse(event);
				responseStream.end(Buffer.from(JSON.stringify(result)), "utf-8");
				// disabled for now, we'll need to revisit this later if needed.
				//TODO: revisit that later
				// await globalThis.__next_route_preloader("warmerEvent");
				return;
			}

			const internalEvent = await converter.convertFrom(event);

			//Handle compression
			const acceptEncoding =
				internalEvent.headers["Accept-Encoding"] ?? internalEvent.headers["accept-encoding"] ?? "";
			let contentEncoding: string;
			let compressedStream: Writable | undefined;

			responseStream.on("error", (err) => {
				error(err);
				responseStream.end();
			});

			if (acceptEncoding.includes("br")) {
				contentEncoding = "br";
				compressedStream = zlib.createBrotliCompress({
					flush: zlib.constants.BROTLI_OPERATION_FLUSH,
					finishFlush: zlib.constants.BROTLI_OPERATION_FINISH,
				});
				compressedStream.pipe(responseStream);
			} else if (acceptEncoding.includes("gzip")) {
				contentEncoding = "gzip";
				compressedStream = zlib.createGzip({
					flush: zlib.constants.Z_SYNC_FLUSH,
				});
				compressedStream.pipe(responseStream);
			} else if (acceptEncoding.includes("deflate")) {
				contentEncoding = "deflate";
				compressedStream = zlib.createDeflate({
					flush: zlib.constants.Z_SYNC_FLUSH,
				});
				compressedStream.pipe(responseStream);
			} else {
				contentEncoding = "identity";
				compressedStream = responseStream;
			}

			const output = await converter.convertTo(event, {
				responseStream,
				writable: compressedStream ?? responseStream,
				contentEncoding,
			});
			if (output.type === "direct") {
				await output.data(await handler(internalEvent));
				return;
			}

			const response = await handler(internalEvent, { streamCreator: output.streamCreator });
			if (globalThis.isEdgeRuntime ?? false) {
				const stream = output.streamCreator.writeHeaders({
					statusCode: response.statusCode,
					headers: response.headers as Record<string, string>,
					cookies: [],
				});
				Readable.fromWeb(response.body).pipe(stream);
			}
		}
	) as (...args: unknown[]) => unknown;

export default {
	wrapper: handler,
	name: "aws-lambda-streaming",
	supportStreaming: true,
} satisfies Wrapper;
