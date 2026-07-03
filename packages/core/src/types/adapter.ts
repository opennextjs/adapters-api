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
	middleware?: NextAdapterOutput;
};

export type PublicFiles = {
	files: string[];
};
