import type { WarmerEvent, WarmerResponse } from "@opennextjs/core/adapters/warmer-function.js";
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
		return directResult ?? output.output;
	};

export default {
	wrapper: handler,
	name: "aws-lambda",
	supportStreaming: false,
};
