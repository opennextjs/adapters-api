import { buildAdapter } from "@opennextjs/core/build/adapter.js";
import type { BuildOptions } from "@opennextjs/core/build/helper.js";
import * as buildHelper from "@opennextjs/core/build/helper.js";
import type { ContentUpdater } from "@opennextjs/core/plugins/content-updater.js";
import { externalChunksPlugin, inlineRouteHandler } from "@opennextjs/core/plugins/inlineRouteHandlers.js";
import type { NextAdapterOutputs } from "@opennextjs/core/types/adapter.js";

export default buildAdapter((_config, buildOpts: BuildOptions) => ({
	serverBundle: {
		additionalPlugins: (updater: ContentUpdater, outputs: NextAdapterOutputs) => {
			const packagePath = buildHelper.getPackagePath(buildOpts);
			return [inlineRouteHandler(updater, outputs, packagePath), externalChunksPlugin(outputs, packagePath)];
		},
	},
}));
