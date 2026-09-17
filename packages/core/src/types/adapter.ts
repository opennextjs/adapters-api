import type { ResolveRoutesParams } from "@next/routing";

export type NextAdapterOutput = {
	/** Next's unique identifier for this executable output. */
	id: string;
	pathname: string;
	filePath: string;
	assets: Record<string, unknown>;
};

/**
 * An ISR/prerendered output.
 *
 * Next emits one for every route that has a (possibly seeded) cache entry:
 * - the concrete pathname of every prerendered route (i.e. `/blog/hello`),
 * - the template pathname of every dynamic route with `getStaticPaths`/`generateStaticParams`
 *   (i.e. `/blog/[slug]`), whatever its fallback mode,
 * - the data variants of both (`.rsc`, `/_next/data/<buildId>/....json`).
 */
export type NextAdapterPrerenderOutput = {
	pathname: string;
	/** The identifier of the executable output that generated this prerender. */
	parentOutputId: string;
};

export type NextAdapterOutputs = {
	pages: NextAdapterOutput[];
	pagesApi: NextAdapterOutput[];
	appPages: NextAdapterOutput[];
	appRoutes: NextAdapterOutput[];
	staticFiles?: NextAdapterOutput[];
	prerenders?: NextAdapterPrerenderOutput[];
	middleware?: NextAdapterOutput;
};

export type NextAdapterRouting = ResolveRoutesParams["routes"];

export type RuntimeRoutingConfig = {
	buildId: string;
	routes: NextAdapterRouting;
	pathnames: string[];
	/**
	 * The servable pathnames, mapped to the route serving them.
	 */
	routeIndex: Record<
		string,
		{
			type: "page" | "app" | "route";
			isFallback: boolean;
			/**
			 * Whether the route is prerendered - it either has a build time cache entry or is a
			 * dynamic route generating (and caching) its pages on demand.
			 */
			isISR: boolean;
			/**
			 * The executable route serving the pathname when it is not the pathname itself - i.e. the
			 * template of the dynamic route that generated a prerendered pathname.
			 */
			route?: string;
		}
	>;
};

export type PublicFiles = {
	files: string[];
};
