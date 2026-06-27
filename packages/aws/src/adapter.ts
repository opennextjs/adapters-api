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
	defaultOverrides: {
		server: {
			wrapper: "aws-lambda-streaming",
			converter: "aws-apigw-v2",
			incrementalCache: "s3",
			tagCache: "dynamodb",
			queue: "sqs",
		},
		revalidation: {
			wrapper: "aws-lambda",
			converter: "sqs-revalidate",
		},
		imageOptimization: {
			wrapper: "aws-lambda",
			converter: "aws-apigw-v2",
			imageLoader: "s3",
		},
		warmer: {
			wrapper: "aws-lambda",
		},
		tagCache: {
			wrapper: "aws-lambda",
			tagCache: "dynamodb",
		},
	},
}));
