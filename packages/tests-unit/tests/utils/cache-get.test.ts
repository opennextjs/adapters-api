import { parseCacheGetResponse } from "@opennextjs/core/utils/cache-get";
import { describe, expect, it } from "vitest";

describe("parseCacheGetResponse", () => {
	it("should return null when x-opennext-cache-found is not 'true'", () => {
		const result = parseCacheGetResponse({ "x-opennext-cache-type": "cache" }, "body");
		expect(result).toBeNull();
	});

	it("should return null when x-opennext-cache-found is 'false'", () => {
		const result = parseCacheGetResponse(
			{ "x-opennext-cache-found": "false", "x-opennext-cache-type": "cache" },
			"body"
		);
		expect(result).toBeNull();
	});

	describe("composable", () => {
		it("should reconstruct a composable cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "composable",
				"x-opennext-cache-composable-stale": "100",
				"x-opennext-cache-composable-expire": "200",
				"x-opennext-cache-composable-timestamp": "300",
				"x-opennext-cache-composable-revalidate": "400",
				"x-opennext-cache-composable-tags": '["tag1","tag2"]',
			};
			const result = parseCacheGetResponse(headers, "test-value");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				value: "test-value",
				tags: ["tag1", "tag2"],
				stale: 100,
				expire: 200,
				timestamp: 300,
				revalidate: 400,
			});
		});

		it("should return null when required composable fields are missing", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "composable",
				"x-opennext-cache-composable-stale": "100",
			};
			const result = parseCacheGetResponse(headers, "test-value");

			expect(result).toBeNull();
		});

		it("should handle empty tags array in composable entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "composable",
				"x-opennext-cache-composable-stale": "100",
				"x-opennext-cache-composable-expire": "200",
				"x-opennext-cache-composable-timestamp": "300",
				"x-opennext-cache-composable-revalidate": "400",
			};
			const result = parseCacheGetResponse(headers, "test-value");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				value: "test-value",
				tags: [],
				stale: 100,
				expire: 200,
				timestamp: 300,
				revalidate: 400,
			});
		});
	});

	describe("fetch", () => {
		it("should reconstruct a fetch cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "fetch",
				"x-opennext-cache-fetch-kind": "FETCH",
				"x-opennext-cache-fetch-data-url": "https://example.com",
				"x-opennext-cache-fetch-data-status": "200",
				"x-opennext-cache-fetch-data-tags": '["tag1"]',
				"x-opennext-cache-fetch-tags": '["tag2"]',
				"x-opennext-cache-revalidate": "60",
				"x-opennext-cache-header-content-type": "application/json",
			};
			const result = parseCacheGetResponse(headers, '{"data":"value"}');

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				kind: "FETCH",
				data: {
					headers: { "content-type": "application/json" },
					body: '{"data":"value"}',
					url: "https://example.com",
					status: 200,
					tags: ["tag1"],
				},
				tags: ["tag2"],
				revalidate: 60,
			});
		});

		it("should return null when fetch kind is not FETCH", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "fetch",
				"x-opennext-cache-fetch-kind": "OTHER",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).toBeNull();
		});

		it("should handle fetch entry without optional fields", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "fetch",
				"x-opennext-cache-fetch-kind": "FETCH",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				kind: "FETCH",
				data: {
					headers: {},
					body: "body",
					url: "",
				},
			});
		});

		it("should collect prefixed headers", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "fetch",
				"x-opennext-cache-fetch-kind": "FETCH",
				"x-opennext-cache-header-content-type": "text/plain",
				"x-opennext-cache-header-x-custom": "custom-value",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			const value = result!.value as { data: { headers: Record<string, string> } };
			expect(value.data.headers).toEqual({
				"content-type": "text/plain",
				"x-custom": "custom-value",
			});
		});

		it("should handle array-valued headers", () => {
			const headers: Record<string, string | string[]> = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "fetch",
				"x-opennext-cache-fetch-kind": "FETCH",
				"x-opennext-cache-header-set-cookie": ["cookie1", "cookie2"],
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			const value = result!.value as { data: { headers: Record<string, string | string[]> } };
			expect(value.data.headers["set-cookie"]).toEqual(["cookie1", "cookie2"]);
		});
	});

	describe("cached file", () => {
		it("should reconstruct a route cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-meta-status": "200",
				"x-opennext-cache-revalidate": "300",
			};
			const result = parseCacheGetResponse(headers, "route body");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "route",
				body: "route body",
				meta: { status: 200 },
				revalidate: 300,
			});
		});

		it("should reconstruct a `false` revalidate", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-revalidate": "false",
			};
			const result = parseCacheGetResponse(headers, "route body");

			expect(result!.value).toEqual({
				type: "route",
				body: "route body",
				revalidate: false,
			});
		});

		it("should reconstruct a page cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "page",
			};
			const body = JSON.stringify({ html: "<html></html>", json: { data: "value" } });
			const result = parseCacheGetResponse(headers, body);

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "page",
				html: "<html></html>",
				json: { data: "value" },
			});
		});

		it("should reconstruct an app cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "app",
			};
			const body = JSON.stringify({
				html: "<html></html>",
				rsc: "rsc-data",
				segmentData: { seg1: "data1" },
			});
			const result = parseCacheGetResponse(headers, body);

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "app",
				html: "<html></html>",
				rsc: "rsc-data",
				segmentData: { seg1: "data1" },
			});
		});

		it("should reconstruct an app cache entry without segmentData", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "app",
			};
			const body = JSON.stringify({ html: "<html></html>", rsc: "rsc-data" });
			const result = parseCacheGetResponse(headers, body);

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "app",
				html: "<html></html>",
				rsc: "rsc-data",
			});
		});

		it("should reconstruct a redirect cache entry", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "redirect",
			};
			const body = JSON.stringify({ destination: "/new-path" });
			const result = parseCacheGetResponse(headers, body);

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "redirect",
				props: { destination: "/new-path" },
			});
		});

		it("should return null for unknown sub-type", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "unknown-type",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).toBeNull();
		});

		it("should handle meta with postponed field", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-meta-postponed": "postponed-data",
				"x-opennext-cache-header-content-type": "text/html",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.value).toEqual({
				type: "route",
				body: "body",
				meta: {
					postponed: "postponed-data",
					headers: { "content-type": "text/html" },
				},
			});
		});
	});

	describe("base metadata", () => {
		it("should include lastModified when x-opennext-cache-last-modified is present", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-last-modified": "1234567890",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.lastModified).toBe(1234567890);
		});

		it("should include shouldBypassTagCache when header is true", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-should-bypass": "true",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.shouldBypassTagCache).toBe(true);
		});

		it("should not include shouldBypassTagCache when header is not 'true'", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-should-bypass": "false",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.shouldBypassTagCache).toBeUndefined();
		});

		it("should handle missing lastModified gracefully", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.lastModified).toBeUndefined();
		});

		it("should handle invalid lastModified number gracefully", () => {
			const headers = {
				"x-opennext-cache-found": "true",
				"x-opennext-cache-type": "cache",
				"x-opennext-cache-sub-type": "route",
				"x-opennext-cache-last-modified": "not-a-number",
			};
			const result = parseCacheGetResponse(headers, "body");

			expect(result).not.toBeNull();
			expect(result!.lastModified).toBeUndefined();
		});
	});
});
