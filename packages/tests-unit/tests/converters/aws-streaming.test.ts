import { PassThrough } from "node:stream";

import converter from "@opennextjs/aws/overrides/converters/aws-streaming.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/index.js", () => ({}));

describe("aws-streaming converter", () => {
	it("writes the Lambda integration prelude and streams the body", async () => {
		const responseStream = new PassThrough() as PassThrough & {
			setContentType: (contentType: string) => void;
		};
		responseStream.setContentType = vi.fn();
		const chunks: Buffer[] = [];
		responseStream.on("data", (chunk: Buffer) => chunks.push(chunk));

		const output = await converter.convertTo(
			{},
			{
				responseStream,
				writable: responseStream,
				contentEncoding: "gzip",
			}
		);
		expect(output.type).toBe("stream");
		if (output.type !== "stream") {
			throw new Error("Expected a streaming converter output");
		}

		const writable = output.streamCreator.writeHeaders({
			statusCode: 201,
			cookies: ["session=abc"],
			headers: { "content-type": "text/plain" },
		});
		writable.end("hello");
		await new Promise<void>((resolve) => responseStream.on("end", resolve));

		expect(responseStream.setContentType).toHaveBeenCalledWith(
			"application/vnd.awslambda.http-integration-response"
		);
		const outputBody = Buffer.concat(chunks);
		const separator = outputBody.indexOf(Buffer.alloc(8));
		expect(separator).toBeGreaterThan(0);
		expect(JSON.parse(outputBody.subarray(0, separator).toString())).toEqual({
			statusCode: 201,
			cookies: ["session=abc"],
			headers: {
				"content-type": "text/plain",
				"content-encoding": "gzip",
			},
		});
		expect(outputBody.subarray(separator + 8).toString()).toBe("hello");
	});
});
