import { Writable } from "node:stream";

import { createStaticPageHandler } from "@opennextjs/core/core/routing/adapterHandler.js";
import { describe, expect, it } from "vitest";

function createResponse() {
	const chunks: Buffer[] = [];
	const headers: Record<string, string> = {};
	const res = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(Buffer.from(chunk));
			callback();
		},
	}) as Writable & { statusCode: number; setHeader: (name: string, value: string) => void };
	res.statusCode = 0;
	res.setHeader = (name, value) => {
		headers[name] = value;
	};
	return { res, headers, body: () => Buffer.concat(chunks).toString() };
}

async function serve(method: string, statusCode = 0) {
	const response = createResponse();
	response.res.statusCode = statusCode;
	await createStaticPageHandler("<p>hello</p>").handler({ method } as never, response.res as never);
	return response;
}

describe("createStaticPageHandler", () => {
	it("serves the page", async () => {
		const { res, headers, body } = await serve("GET");

		expect(res.statusCode).toBe(200);
		expect(headers["content-type"]).toBe("text/html; charset=utf-8");
		expect(body()).toBe("<p>hello</p>");
	});

	it("sends no body to a HEAD request", async () => {
		const { res, body } = await serve("HEAD");

		expect(res.statusCode).toBe(200);
		expect(body()).toBe("");
	});

	it("refuses other methods as Next.js does", async () => {
		const { res, headers, body } = await serve("POST");

		expect(res.statusCode).toBe(405);
		expect(headers.allow).toBe("GET, HEAD");
		expect(body()).toBe("Method Not Allowed");
	});

	it("keeps the status set by a rewrite", async () => {
		const { res, body } = await serve("GET", 403);

		expect(res.statusCode).toBe(403);
		expect(body()).toBe("<p>hello</p>");
	});
});
