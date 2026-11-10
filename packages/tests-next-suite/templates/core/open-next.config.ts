export default {
	default: {
		override: {
			wrapper: "express-dev",
			converter: "node",
			cache: "local",
			queue: "direct",
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
};
