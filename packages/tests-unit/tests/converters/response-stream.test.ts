import { createBufferedStreamCreator } from "@opennextjs/aws/overrides/converters/response-stream.js";
import { describe, expect, it } from "vitest";

describe("createBufferedStreamCreator", () => {
	it("rejects its output when the response stream is destroyed", async () => {
		const { streamCreator, output } = createBufferedStreamCreator((_prelude, body) => body);
		const stream = streamCreator.writeHeaders({ statusCode: 200, cookies: [], headers: {} });
		const streamError = new Error("stream failed");

		stream.on("error", () => undefined);
		stream.destroy(streamError);

		await expect(output).rejects.toBe(streamError);
	});

	it("rejects its output when the response stream closes prematurely", async () => {
		const { streamCreator, output } = createBufferedStreamCreator((_prelude, body) => body);
		const stream = streamCreator.writeHeaders({ statusCode: 200, cookies: [], headers: {} });

		stream.destroy();

		await expect(output).rejects.toThrow("Response stream was destroyed before it finished");
	});

	it("uses explicit binary response metadata", async () => {
		const { streamCreator, output } = createBufferedStreamCreator((_prelude, body, isBase64Encoded) => ({
			body,
			isBase64Encoded,
		}));
		const stream = streamCreator.writeHeaders({
			statusCode: 200,
			cookies: [],
			headers: { "content-type": "application/x-custom" },
			isBase64Encoded: true,
		});
		stream.end(Buffer.from([0xff, 0x00]));

		await expect(output).resolves.toEqual({
			body: Buffer.from([0xff, 0x00]),
			isBase64Encoded: true,
		});
	});
});
