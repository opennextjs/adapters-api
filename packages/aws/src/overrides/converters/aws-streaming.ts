import type { Writable } from "node:stream";

import type { StreamCreator } from "@opennextjs/core/types/open-next.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { convertFromAPIGatewayProxyEventV2 } from "./aws-apigw-v2.js";

type StreamingContext = {
	responseStream: Writable & { setContentType(contentType: string): void };
	writable: Writable;
	contentEncoding: string;
};

const converter: Converter = {
	convertFrom: (event) => convertFromAPIGatewayProxyEventV2(event as APIGatewayProxyEventV2),
	convertTo: async (_event, context) => {
		const { responseStream, writable, contentEncoding } = context as StreamingContext;
		const streamCreator: StreamCreator = {
			writeHeaders(prelude) {
				responseStream.setContentType("application/vnd.awslambda.http-integration-response");
				responseStream.write(
					JSON.stringify({
						...prelude,
						headers: {
							...prelude.headers,
							"content-encoding": contentEncoding,
						},
					})
				);
				responseStream.write(new Uint8Array(8));
				return writable;
			},
			retainChunks: false,
		};

		return { type: "stream" as const, streamCreator };
	},
	name: "aws-streaming",
};

export default converter;
