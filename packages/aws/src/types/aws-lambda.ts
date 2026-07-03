import type { Writable } from "node:stream";

import type { WarmerEvent, WarmerResponse } from "@opennextjs/core/adapters/warmer-function.js";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyEventV2,
	APIGatewayProxyResult,
	APIGatewayProxyResultV2,
	CloudFrontRequestEvent,
	CloudFrontRequestResult,
	Context,
} from "aws-lambda";

export interface ResponseStream extends Writable {
	getBufferedData(): Buffer;
	setContentType(contentType: string): void;
}

type Handler = (
	event: APIGatewayProxyEventV2,
	responseStream: ResponseStream,
	context: Context
) => Promise<unknown>;

interface Metadata {
	statusCode: number;
	headers: Record<string, string>;
}

declare global {
	namespace awslambda {
		function streamifyResponse(handler: Handler): Handler;
	}
}

export type AwsLambdaEvent =
	| APIGatewayProxyEventV2
	| CloudFrontRequestEvent
	| APIGatewayProxyEvent
	| WarmerEvent;

export type AwsLambdaReturn =
	| APIGatewayProxyResultV2
	| APIGatewayProxyResult
	| CloudFrontRequestResult
	| WarmerResponse;
