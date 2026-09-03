import { normalizeRouting } from "@opennextjs/core/build/normalizeRouting.js";
import type { NextAdapterRouting } from "@opennextjs/core/types/adapter.js";

function routing(overrides: Partial<NextAdapterRouting> = {}): NextAdapterRouting {
	return {
		beforeMiddleware: [],
		beforeFiles: [],
		afterFiles: [],
		dynamicRoutes: [],
		onMatch: [],
		fallback: [],
		...overrides,
	};
}

const NO_I18N = { locales: [], apiPathnames: new Set<string>() };

describe("normalizeRouting", () => {
	it("leaves the routing untouched when `i18n` is not configured", () => {
		const routes = routing({
			afterFiles: [{ source: "/rewrite", sourceRegex: "^\\/rewrite$", destination: "/" } as never],
		});

		expect(normalizeRouting(routes, NO_I18N)).toEqual(routes);
	});

	describe("locales", () => {
		const options = { locales: ["en", "nl"], apiPathnames: new Set<string>() };

		it("emits a variant of a non localized route for every locale", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{ source: "/rewrite", sourceRegex: "^\\/rewrite(?:\\/)?$", destination: "/ssr" } as never,
					],
				}),
				options
			);

			expect(result.afterFiles).toEqual([
				{ source: "/en/rewrite", sourceRegex: "^\\/en\\/rewrite(?:\\/)?$", destination: "/en/ssr" },
				{ source: "/nl/rewrite", sourceRegex: "^\\/nl\\/rewrite(?:\\/)?$", destination: "/nl/ssr" },
				{ source: "/rewrite", sourceRegex: "^\\/rewrite(?:\\/)?$", destination: "/ssr" },
			]);
		});

		it("resolves a destination of `/` to the root of the locale", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [{ source: "/rewrite", sourceRegex: "^\\/rewrite$", destination: "/" } as never],
				}),
				options
			);

			expect(result.afterFiles[0]?.destination).toBe("/en");
		});

		it("does not localize an external destination", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/image",
							sourceRegex: "^\\/image$",
							destination: "https://opennext.js.org/i.png",
						} as never,
					],
				}),
				options
			);

			expect(result.afterFiles[0]?.destination).toBe("https://opennext.js.org/i.png");
		});

		it("leaves the routes Next already localized alone", () => {
			const routes = routing({
				afterFiles: [
					{
						source: "/:nextInternalLocale(en|nl)/rewrite/",
						sourceRegex: "^(?:\\/(en|nl))\\/rewrite\\/$",
						destination: "/$1/ssr/",
					} as never,
					{ source: "/en/rewrite/", sourceRegex: "^\\/en\\/rewrite\\/$", destination: "/ssr/" } as never,
				],
			});

			expect(normalizeRouting(routes, options).afterFiles).toEqual(routes.afterFiles);
		});

		it("leaves a priority route alone - it is matched before the request is localized", () => {
			const routes = routing({
				beforeMiddleware: [
					{
						source: "/:notfile",
						sourceRegex: "^(?:\\/([^/\\.]+))$",
						headers: { Location: "/$1/" },
						status: 308,
						priority: true,
					} as never,
				],
			});

			expect(normalizeRouting(routes, options).beforeMiddleware).toEqual(routes.beforeMiddleware);
		});
	});

	describe("redirects", () => {
		it("gives a redirect the destination the resolver stops at", () => {
			const result = normalizeRouting(
				routing({
					beforeMiddleware: [
						{
							source: "/redirect/",
							sourceRegex: "^\\/redirect\\/$",
							headers: { Location: "/$1/ssr/" },
							status: 307,
						} as never,
					],
				}),
				NO_I18N
			);

			expect(result.beforeMiddleware[0]?.destination).toBe("/$1/ssr/");
		});

		it("leaves a route that only sets headers without a destination", () => {
			const result = normalizeRouting(
				routing({
					beforeMiddleware: [
						{ source: "/", sourceRegex: "^\\/$", headers: { "x-custom": "value" } } as never,
					],
				}),
				NO_I18N
			);

			expect(result.beforeMiddleware[0]?.destination).toBeUndefined();
		});
	});

	describe("api routes", () => {
		const options = { locales: ["en"], apiPathnames: new Set(["/api/query", "/api/dynamic/[slug]"]) };

		it("drops the locale of a dynamic route serving an API route", () => {
			const result = normalizeRouting(
				routing({
					dynamicRoutes: [
						{
							source: "/api/dynamic/[slug]",
							sourceRegex: "^[/]?(?<nextLocale>[^/]{1,})/api/dynamic/(?<nxtPslug>[^/]+?)(?:/)?$",
							destination: "/$nextLocale/api/dynamic/[slug]?nxtPslug=$nxtPslug",
						} as never,
					],
				}),
				options
			);

			expect(result.dynamicRoutes[0]).toEqual({
				source: "/api/dynamic/[slug]",
				sourceRegex: "^[/]?/api/dynamic/(?<nxtPslug>[^/]+?)(?:/)?$",
				destination: "/api/dynamic/[slug]?nxtPslug=$nxtPslug",
			});
		});

		it("drops the locale of a destination targeting an API route", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/:nextInternalLocale(en)/rewriteWithQuery/",
							sourceRegex: "^(?:\\/(en))\\/rewriteWithQuery\\/$",
							destination: "/$1/api/query?q=1&nextInternalLocale=$1",
						} as never,
					],
				}),
				options
			);

			expect(result.afterFiles[0]?.destination).toBe("/api/query?q=1&nextInternalLocale=$1");
		});

		it("does not localize a variant destination targeting an API route", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{ source: "/rewrite", sourceRegex: "^\\/rewrite$", destination: "/api/query?q=1" } as never,
					],
				}),
				options
			);

			expect(result.afterFiles[0]).toEqual({
				source: "/en/rewrite",
				sourceRegex: "^\\/en\\/rewrite$",
				destination: "/api/query?q=1",
			});
		});
	});

	describe("`has` captures", () => {
		it("renames a capture spanning the whole condition value to the key of the condition", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/rewriteUsingQuery",
							sourceRegex: "^\\/rewriteUsingQuery$",
							destination: "/$destination/",
							has: [{ type: "query", key: "d", value: "(?<destination>\\w+)" }],
						} as never,
					],
				}),
				NO_I18N
			);

			expect(result.afterFiles[0]?.destination).toBe("/$d/");
		});

		it("does not rename a longer capture reference with the same prefix", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/rewrite",
							sourceRegex: "^/rewrite$",
							destination: "/$id/$identifier",
							has: [{ type: "query", key: "value", value: "(?<id>\\w+)" }],
						} as never,
					],
				}),
				NO_I18N
			);

			expect(result.afterFiles[0]?.destination).toBe("/$value/$identifier");
		});

		it("leaves a capture that only spans a part of the condition value", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/rewriteUsingQuery",
							sourceRegex: "^\\/rewriteUsingQuery$",
							destination: "/$destination/",
							has: [{ type: "query", key: "d", value: "page-(?<destination>\\w+)" }],
						} as never,
					],
				}),
				NO_I18N
			);

			expect(result.afterFiles[0]?.destination).toBe("/$destination/");
		});

		it("leaves a capture whose value nests a group it does not close", () => {
			const result = normalizeRouting(
				routing({
					afterFiles: [
						{
							source: "/rewriteUsingQuery",
							sourceRegex: "^\\/rewriteUsingQuery$",
							destination: "/$destination/",
							has: [{ type: "query", key: "d", value: "(?<destination>\\w+)|(other)" }],
						} as never,
					],
				}),
				NO_I18N
			);

			expect(result.afterFiles[0]?.destination).toBe("/$destination/");
		});
	});
});
