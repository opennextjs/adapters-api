import type { ResolveRoutesParams } from "@next/routing";

export type NextAdapterOutput = {
	pathname: string;
	filePath: string;
	assets: Record<string, unknown>;
};

export type NextAdapterOutputs = {
	pages: NextAdapterOutput[];
	pagesApi: NextAdapterOutput[];
	appPages: NextAdapterOutput[];
	appRoutes: NextAdapterOutput[];
	staticFiles?: NextAdapterOutput[];
	prerenders?: NextAdapterOutput[];
	middleware?: NextAdapterOutput;
};

export type NextAdapterRouting = ResolveRoutesParams["routes"];

export type RuntimeRoutingConfig = {
	buildId: string;
	routes: NextAdapterRouting;
	pathnames: string[];
	routeIndex: Record<
		string,
		{
			type: "page" | "app" | "route";
			isFallback: boolean;
		}
	>;
};

export type PublicFiles = {
	files: string[];
};
