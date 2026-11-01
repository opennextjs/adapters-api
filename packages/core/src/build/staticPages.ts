import type { NextAdapterOutputs } from "../types/adapter.js";

export type StaticPage = {
	/** The pathname the page is served on. */
	route: string;
	filePath: string;
};

const ERROR_PAGES = new Set(["/404", "/500"]);

/**
 * Lists the pages Next.js fully rendered to HTML at build time, i.e. pages without data fetching.
 *
 * Next.js reports them as static files with no route to reach them, and with `/index` as the pathname
 * of an index page. The html files of the public directory are static files too, those are assets
 * whose pathname is their file name.
 *
 * @param outputs The outputs of the build.
 * @returns The pages, with the pathname they are served on.
 */
export function getStaticPages(outputs: Pick<NextAdapterOutputs, "staticFiles">): StaticPage[] {
	return (outputs.staticFiles ?? [])
		.filter(
			({ pathname, filePath }) =>
				filePath.endsWith(".html") && !pathname.endsWith(".html") && !ERROR_PAGES.has(pathname)
		)
		.map(({ pathname, filePath }) => ({
			route: pathname.replace(/\/index$/, "") || "/",
			filePath,
		}));
}
