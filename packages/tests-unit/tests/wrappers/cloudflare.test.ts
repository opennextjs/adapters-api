import edgeConverter from "@opennextjs/core/overrides/converters/edge.js";
import cloudflareEdge from "@opennextjs/core/overrides/wrappers/cloudflare-edge.js";
import cloudflareNode from "@opennextjs/core/overrides/wrappers/cloudflare-node.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import { describe, expect, it } from "vitest";

describe.each([
	["edge", cloudflareEdge],
	["node", cloudflareNode],
])("cloudflare-%s wrapper", (_name, wrapper) => {
	it("returns the response as soon as headers are available", async () => {
		const pending: Promise<unknown>[] = [];
		const { promise: continueHandler, resolve: resolveHandler } = Promise.withResolvers<void>();
		const wrapped = await wrapper.wrapper(async (_event, options) => {
			const stream = options?.streamCreator?.writeHeaders({
				statusCode: 200,
				cookies: [],
				headers: { "content-type": "text/plain" },
			});
			await continueHandler;
			stream?.end("hello");
			return { type: "core", statusCode: 200, headers: {}, isBase64Encoded: false };
		}, edgeConverter);
		const request = new Request("https://example.com/");
		const responsePromise = wrapped(request, {}, { waitUntil: (promise) => pending.push(promise) });
		const resolution = await Promise.race([
			responsePromise.then(() => "response"),
			new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 50)),
		]);
		expect(resolution).toBe("response");
		const response = (await responsePromise) as Response;

		expect(response).toBeInstanceOf(Response);
		resolveHandler();
		expect(await response.text()).toBe("hello");
		await Promise.all(pending);
	});

	it("propagates handler failures before headers are written", async () => {
		const handlerError = new Error("handler failed");
		const wrapped = await wrapper.wrapper(async () => Promise.reject(handlerError), edgeConverter);

		await expect(
			wrapped(new Request("https://example.com/"), {}, { waitUntil: () => undefined })
		).rejects.toBe(handlerError);
	});

	it("aborts the response body when the handler fails after writing headers", async () => {
		const pending: Promise<unknown>[] = [];
		const handlerError = new Error("handler failed after headers");
		const wrapped = await wrapper.wrapper(async (_event, options) => {
			options?.streamCreator?.writeHeaders({ statusCode: 200, cookies: [], headers: {} });
			throw handlerError;
		}, edgeConverter);

		const response = (await wrapped(
			new Request("https://example.com/"),
			{},
			{
				waitUntil: (promise) => pending.push(promise),
			}
		)) as Response;
		await expect(response.text()).rejects.toBe(handlerError);
		await Promise.allSettled(pending);
	});

	it("provides waitUntil to handlers using a direct converter", async () => {
		const waitUntil = () => undefined;
		const converter = {
			name: "direct",
			convertFrom: edgeConverter.convertFrom,
			convertTo: async () => ({ type: "direct" as const, data: async () => "response" }),
		} satisfies Converter;
		const wrapped = await wrapper.wrapper(async (_event, options) => {
			expect(options?.waitUntil).toBeTypeOf("function");
			return { type: "core", statusCode: 200, headers: {}, isBase64Encoded: false };
		}, converter);

		await expect(wrapped(new Request("https://example.com/"), {}, { waitUntil })).resolves.toBe("response");
	});
});
