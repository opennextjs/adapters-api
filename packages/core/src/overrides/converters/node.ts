import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import cookieParser from "cookie";

import type { InternalResult } from "@/types/open-next";
import type { Converter } from "@/types/overrides";

import { extractHostFromHeaders, getQueryFromSearchParams } from "./utils.js";

const converter: Converter = {
	convertFrom: async (event: unknown) => {
		const req = event as IncomingMessage & { protocol?: string };
		const shouldHaveBody = req.method !== "GET" && req.method !== "HEAD";
		const body: ReadableStream | undefined = shouldHaveBody ? Readable.toWeb(req) : undefined;

		const headers = Object.fromEntries(
			Object.entries(req.headers ?? {})
				.map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(",") : value])
				.filter(([key]) => key)
		);
		// https://nodejs.org/api/http.html#messageurl
		const url = new URL(
			`${req.protocol ? req.protocol : "http"}://${extractHostFromHeaders(headers)}${req.url}`
		);
		const query = getQueryFromSearchParams(url.searchParams);

		const cookieHeader = req.headers.cookie;
		const cookies = cookieHeader ? (cookieParser.parse(cookieHeader) as Record<string, string>) : {};

		return {
			type: "core",
			method: req.method ?? "GET",
			rawPath: url.pathname,
			url: url.href,
			body,
			headers,
			remoteAddress: (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? "::1",
			query,
			cookies,
		};
	},
	// Nothing to do here, it's streaming
	convertTo: async (internalResult: InternalResult) => ({
		body: internalResult.body,
		headers: internalResult.headers,
		statusCode: internalResult.statusCode,
	}),
	name: "node",
};

export default converter;
