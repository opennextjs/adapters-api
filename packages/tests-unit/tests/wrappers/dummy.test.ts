import { Writable } from "node:stream";

import wrapper from "@opennextjs/core/overrides/wrappers/dummy.js";
import type { Converter } from "@opennextjs/core/types/overrides.js";
import { describe, expect, it } from "vitest";

describe("dummy wrapper", () => {
	it("returns buffered converter output after streaming", async () => {
		const converter = {
			name: "buffered",
			convertFrom: async (event: unknown) => event,
			convertTo: async () => ({
				type: "stream" as const,
				streamCreator: { writeHeaders: () => new Writable({ write: (_chunk, _encoding, done) => done() }) },
				output: Promise.resolve("platform response"),
			}),
		} satisfies Converter;
		const wrapped = await wrapper.wrapper(
			async () => ({ type: "core", statusCode: 200, headers: {}, isBase64Encoded: false }),
			converter
		);

		await expect(wrapped({ type: "core" })).resolves.toBe("platform response");
	});

	it("returns exceptional direct mappings from streaming converters", async () => {
		const converter = {
			name: "exceptional",
			convertFrom: async (event: unknown) => event,
			convertTo: async () => ({
				type: "stream" as const,
				streamCreator: { writeHeaders: () => new Writable() },
				data: async () => "direct response",
			}),
		} satisfies Converter;
		const wrapped = await wrapper.wrapper(
			async () => ({ type: "core", statusCode: 200, headers: {}, isBase64Encoded: false }),
			converter
		);

		await expect(wrapped({ type: "core" })).resolves.toBe("direct response");
	});

	it("preserves a null direct mapping", async () => {
		const converter = {
			name: "null-result",
			convertFrom: async (event: unknown) => event,
			convertTo: async () => ({
				type: "stream" as const,
				streamCreator: { writeHeaders: () => new Writable() },
				output: Promise.resolve("buffered response"),
				data: async () => null,
			}),
		} satisfies Converter;
		const wrapped = await wrapper.wrapper(
			async () => ({ type: "core", statusCode: 200, headers: {}, isBase64Encoded: false }),
			converter
		);

		await expect(wrapped({ type: "core" })).resolves.toBeNull();
	});
});
