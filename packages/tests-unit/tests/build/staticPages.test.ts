import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getStaticPages } from "@opennextjs/core/build/staticPages.js";
import { renderStaticPages } from "@opennextjs/core/plugins/inlineRouteHandlers.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/core/adapters/config/index.js", () => ({}));

function staticFile(pathname: string, filePath: string) {
	return { id: pathname, pathname, filePath, assets: {} };
}

function outputs(...staticFiles: ReturnType<typeof staticFile>[]) {
	return { pages: [], pagesApi: [], appPages: [], appRoutes: [], staticFiles };
}

describe("getStaticPages", () => {
	it("lists the html pages with the route they are served on", () => {
		const pages = getStaticPages(outputs(staticFile("/about", "/app/.next/server/pages/about.html")));

		expect(pages).toEqual([{ route: "/about", filePath: "/app/.next/server/pages/about.html" }]);
	});

	it.each([
		["/index", "/", {}],
		["/docs/index", "/docs", { basePath: "/docs" }],
		["/en/index", "/en", { locales: ["en", "fr"] }],
		["/docs/en/index", "/docs/en", { basePath: "/docs", locales: ["en"] }],
		["/index/index/foo", "/index/foo", {}],
		["/foo/index", "/foo/index", {}],
		["/blog/index-of-posts", "/blog/index-of-posts", {}],
	])("serves %s on %s", (pathname, route, options) => {
		const pages = getStaticPages(
			outputs(staticFile(pathname, `/app/.next/server/pages${pathname}.html`)),
			options
		);

		expect(pages.map((page) => page.route)).toEqual([route]);
	});

	it.each([
		["/en/404", { locales: ["en"] }],
		["/docs/500", { basePath: "/docs" }],
		["/docs/fr/404", { basePath: "/docs", locales: ["fr"] }],
	])("leaves out the error page %s", (pathname, options) => {
		const pages = getStaticPages(
			outputs(staticFile(pathname, `/app/.next/server/pages${pathname}.html`)),
			options
		);

		expect(pages).toEqual([]);
	});

	it("leaves out the error pages, which are not routes", () => {
		const pages = getStaticPages(
			outputs(
				staticFile("/404", "/app/.next/server/pages/404.html"),
				staticFile("/500", "/app/.next/server/pages/500.html")
			)
		);

		expect(pages).toEqual([]);
	});

	it("leaves out assets, including the html files of the public directory", () => {
		const pages = getStaticPages(
			outputs(
				staticFile("/_next/static/a.js", "/app/.next/static/a.js"),
				staticFile("/page.html", "/app/public/page.html")
			)
		);

		expect(pages).toEqual([]);
	});

	it("handles builds without static files", () => {
		expect(getStaticPages({ pages: [], pagesApi: [], appPages: [], appRoutes: [] })).toEqual([]);
	});
});

describe("renderStaticPages", () => {
	it("generates the content of the pages, whatever characters they hold", () => {
		const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-pages-"));
		fs.mkdirSync(path.join(nextDir, "server/pages"), { recursive: true });
		fs.writeFileSync(path.join(nextDir, "required-server-files.json"), JSON.stringify({ config: {} }));
		const html = `<p class="a">$& costs $1 \`now\`</p>\n`;
		fs.writeFileSync(path.join(nextDir, "server/pages/index.html"), html);

		const code = renderStaticPages(
			outputs(staticFile("/index", path.join(nextDir, "server/pages/index.html")))
		);

		expect(new Function(`${code}; return staticPages;`)()).toEqual({ "/": html });
	});

	it("keys the pages like the routing config, with the base path and locales of the build", () => {
		const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-pages-"));
		fs.mkdirSync(path.join(nextDir, "server/pages/en"), { recursive: true });
		fs.writeFileSync(
			path.join(nextDir, "required-server-files.json"),
			JSON.stringify({ config: { basePath: "/docs", i18n: { locales: ["en"], defaultLocale: "en" } } })
		);
		fs.writeFileSync(path.join(nextDir, "server/pages/en/index.html"), "en");
		fs.writeFileSync(path.join(nextDir, "server/pages/en/404.html"), "404");

		const code = renderStaticPages(
			outputs(
				staticFile("/docs/en/index", path.join(nextDir, "server/pages/en/index.html")),
				staticFile("/docs/en/404", path.join(nextDir, "server/pages/en/404.html"))
			)
		);

		expect(new Function(`${code}; return staticPages;`)()).toEqual({ "/docs/en": "en" });
	});
});
