import { buildAdapter } from "@opennextjs/core/build/adapter.js";
import type { BuildOptions } from "@opennextjs/core/build/helper.js";
import * as buildHelper from "@opennextjs/core/build/helper.js";
import type { ContentUpdater } from "@opennextjs/core/plugins/content-updater.js";
import { externalChunksPlugin, inlineRouteHandler } from "@opennextjs/core/plugins/inlineRouteHandlers.js";
import type { NextAdapterOutputs } from "@opennextjs/core/types/adapter.js";

export default buildAdapter((_config, buildOpts: BuildOptions) => ({
	defaultOverrides: {
		server: {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
			converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
			tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
			queue: "@opennextjs/aws/overrides/queue/sqs.js",
		},
		revalidation: {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			converter: "@opennextjs/aws/overrides/converters/sqs-revalidate.js",
		},
		imageOptimization: {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			imageLoader: "@opennextjs/aws/overrides/imageLoader/s3.js",
		},
		warmer: { wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js" },
		tagCache: {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
		},
		middleware: {
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			converter: "@opennextjs/aws/overrides/converters/aws-cloudfront.js",
			incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3-lite.js",
			tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb-lite.js",
			queue: "@opennextjs/aws/overrides/queue/sqs-lite.js",
		},
	},
	serverBundle: {
		externals: ["./middleware.mjs"],
		additionalPlugins: (updater: ContentUpdater, outputs: NextAdapterOutputs) => {
			const packagePath = buildHelper.getPackagePath(buildOpts);
			return [inlineRouteHandler(updater, outputs, packagePath), externalChunksPlugin(outputs, packagePath)];
		},
	},
}));
