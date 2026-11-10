import type { NextAdapterOutputs } from "../types/adapter.js";

export type StaticPage = {
	/** The pathname the page is served on. */
	route: string;
	filePath: string;
};

export type StaticPageOptions = {
	basePath?: string;
	locales?: string[];
};

const ERROR_PAGES = new Set(["/404", "/500"]);

/** Inverse of the `normalizePagePath` of Next.js, which prefixes `/index` to the pages starting with it. */
function denormalizePagePath(page: string): string {
	if (page === "/index") {
		return "/";
	}
	return page.startsWith("/index/") ? page.slice("/index".length) : page;
}

/**
 * Lists the pages Next.js fully rendered to HTML at build time, i.e. pages without data fetching.
 *
 * Next.js reports them as static files with no route to reach them. Their pathname holds the base path,
 * the locale and the page path as Next.js normalizes it, `/index` for the index page. The html files of
 * the public directory are static files too, those are assets whose pathname is their file name.
 *
 * @param outputs The outputs of the build.
 * @param options The base path and the locales of the build.
 * @returns The pages, with the pathname they are served on.
 */
export function getStaticPages(
	outputs: Pick<NextAdapterOutputs, "staticFiles">,
	{ basePath = "", locales = [] }: StaticPageOptions = {}
): StaticPage[] {
	return (outputs.staticFiles ?? []).flatMap(({ pathname, filePath }) => {
		if (!filePath.endsWith(".html") || pathname.endsWith(".html")) {
			return [];
		}
		let page = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
		const segment = page.split("/")[1] ?? "";
		const locale = locales.includes(segment) ? `/${segment}` : "";
		page = page.slice(locale.length) || "/";
		// The error pages are rendered by the server with their status code, they are not routes.
		if (ERROR_PAGES.has(page)) {
			return [];
		}
		const route = denormalizePagePath(page);
		return [{ route: `${basePath}${locale}${route === "/" ? "" : route}` || "/", filePath }];
	});
}
