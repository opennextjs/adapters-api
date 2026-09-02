import { finished } from "node:stream/promises";

import type { WarmerEvent, WarmerResponse } from "@opennextjs/core/adapters/warmer-function.js";
import type { Wrapper, WrapperHandler } from "@opennextjs/core/types/overrides.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { streamResponse } from "./aws-lambda.js";
import { selectCompressionEncoding } from "./compression.js";

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
				await finished(responseStream);
				// disabled for now, we'll need to revisit this later if needed.
				//TODO: revisit that later
				// await globalThis.__next_route_preloader("warmerEvent");
				return;
			}

			const internalEvent = await converter.convertFrom(event);

			//Handle compression
			const acceptEncoding =
				internalEvent.headers["Accept-Encoding"] ?? internalEvent.headers["accept-encoding"] ?? "";
			const contentEncoding = selectCompressionEncoding(acceptEncoding) ?? "identity";

			const output = await converter.convertTo(event, {
				responseStream,
				contentEncoding,
			});
			if (output.type === "direct") {
				await output.data(await handler(internalEvent));
				return;
			}

			const response = await handler(internalEvent, { streamCreator: output.streamCreator });
			if (globalThis.isEdgeRuntime ?? false) {
				await streamResponse(response, output.streamCreator);
			}
			await output.output;
		}
	) as (...args: unknown[]) => unknown;

export default {
	wrapper: handler,
	name: "aws-lambda-streaming",
	supportStreaming: true,
} satisfies Wrapper;
