import type { OpenNextConfig, OverrideOptions } from "@opennextjs/core/types/open-next.js";

const devOverride = {
	wrapper: "express-dev",
	converter: "node",
	cache: "local",
	queue: "direct",
} satisfies OverrideOptions;

export default {
	default: {
		override: devOverride,
	},
	functions: {
		api: {
			override: devOverride,
			routes: ["app/api/client/route", "app/api/host/route", "pages/api/hello"],
			patterns: ["/api/*"],
		},
	},
	imageOptimization: {
		override: {
			wrapper: "dummy",
			converter: "dummy",
		},
		loader: "fs-dev",
	},
	cacheHandler: {
		override: {
			wrapper: "dummy",
			converter: "dummy",
		},
		incrementalCache: "fs-dev",
		tagCache: "fs-dev-nextMode",
	},
	// You can override the build command here so that you don't have to rebuild next every time you make a change
	// buildCommand: "echo 'No build command'",
} satisfies OpenNextConfig;
