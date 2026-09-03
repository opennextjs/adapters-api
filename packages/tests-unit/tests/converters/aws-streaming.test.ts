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
				contentEncoding: "identity",
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
		await output.output;

		expect(responseStream.setContentType).toHaveBeenCalledWith(
			"application/vnd.awslambda.http-integration-response"
		);
		const outputBody = Buffer.concat(chunks);
		const separator = outputBody.indexOf(Buffer.alloc(8));
		expect(separator).toBeGreaterThan(0);
		expect(JSON.parse(outputBody.subarray(0, separator).toString())).toEqual({
			statusCode: 201,
			cookies: ["session=abc"],
			headers: { "content-type": "text/plain", "content-encoding": "identity" },
		});
		expect(outputBody.subarray(separator + 8).toString()).toBe("hello");
	});

	it("does not recompress an already encoded response", async () => {
		const responseStream = new PassThrough() as PassThrough & {
			setContentType: (contentType: string) => void;
		};
		responseStream.setContentType = vi.fn();
		const chunks: Buffer[] = [];
		responseStream.on("data", (chunk: Buffer) => chunks.push(chunk));
		const output = await converter.convertTo({}, { responseStream, contentEncoding: "gzip" });
		if (output.type !== "stream") throw new Error("Expected a streaming converter output");

		const writable = output.streamCreator.writeHeaders({
			statusCode: 200,
			cookies: [],
			headers: { "content-encoding": "br", "content-length": "7" },
		});
		writable.end("encoded");
		await output.output;

		const outputBody = Buffer.concat(chunks);
		const separator = outputBody.indexOf(Buffer.alloc(8));
		expect(JSON.parse(outputBody.subarray(0, separator).toString()).headers).toEqual({
			"content-encoding": "br",
			"content-length": "7",
		});
		expect(outputBody.subarray(separator + 8).toString()).toBe("encoded");
	});

	it("compresses negotiated responses and removes their original content length", async () => {
		const responseStream = new PassThrough() as PassThrough & {
			setContentType: (contentType: string) => void;
		};
		responseStream.setContentType = vi.fn();
		const chunks: Buffer[] = [];
		responseStream.on("data", (chunk: Buffer) => chunks.push(chunk));
		const output = await converter.convertTo({}, { responseStream, contentEncoding: "gzip" });
		if (output.type !== "stream") throw new Error("Expected a streaming converter output");

		const writable = output.streamCreator.writeHeaders({
			statusCode: 200,
			cookies: [],
			headers: { "content-length": "5" },
		});
		writable.end("hello");
		await output.output;

		const outputBody = Buffer.concat(chunks);
		const separator = outputBody.indexOf(Buffer.alloc(8));
		expect(JSON.parse(outputBody.subarray(0, separator).toString()).headers).toEqual({
			"content-encoding": "gzip",
			vary: "Accept-Encoding",
		});
		expect((await import("node:zlib")).gunzipSync(outputBody.subarray(separator + 8)).toString()).toBe(
			"hello"
		);
	});

	it("does not create a compressed body for a bodyless status", async () => {
		const responseStream = new PassThrough() as PassThrough & {
			setContentType: (contentType: string) => void;
		};
		responseStream.setContentType = vi.fn();
		const chunks: Buffer[] = [];
		responseStream.on("data", (chunk: Buffer) => chunks.push(chunk));
		const output = await converter.convertTo({}, { responseStream, contentEncoding: "gzip" });
		if (output.type !== "stream") throw new Error("Expected a streaming converter output");

		output.streamCreator.writeHeaders({ statusCode: 204, cookies: [], headers: {} }).end();
		await output.output;

		const outputBody = Buffer.concat(chunks);
		const separator = outputBody.indexOf(Buffer.alloc(8));
		expect(JSON.parse(outputBody.subarray(0, separator).toString()).headers).toEqual({
			"content-encoding": "identity",
		});
		expect(outputBody.subarray(separator + 8)).toHaveLength(0);
	});
});
