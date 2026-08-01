import logger from "@opennextjs/core/logger.js";
import type { ExternalMiddlewareConfig } from "@opennextjs/core/types/open-next.js";

import type { OpenNextConfig } from "../../../api/config.js";

/**
 * Ensures open next is configured for cloudflare.
 *
 * @param config OpenNext configuration.
 */
export function ensureCloudflareConfig(config: OpenNextConfig) {
	const mwIsMiddlewareExternal = config.middleware?.external === true;
	const mwConfig = mwIsMiddlewareExternal ? (config.middleware as ExternalMiddlewareConfig) : undefined;
	const isContainer = config.cloudflare?.container === true;

	const requirements = {
		// Check for the default function
		dftUseCloudflareWrapper: config.default?.override?.wrapper === "cloudflare-node",
		dftUseEdgeConverter: config.default?.override?.converter === "edge",
		dftUseFetchProxy: config.default?.override?.proxyExternalRequest === "fetch",
		dftMaybeUseCache:
			config.default?.override?.incrementalCache === "dummy" ||
			typeof config.default?.override?.incrementalCache === "function",
		dftMaybeUseTagCache:
			config.default?.override?.tagCache === "dummy" ||
			typeof config.default?.override?.incrementalCache === "function",
		dftMaybeUseQueue:
			config.default?.override?.queue === "dummy" ||
			config.default?.override?.queue === "direct" ||
			typeof config.default?.override?.queue === "function",
		dftUseNodeWrapper: config.default?.override?.wrapper === "node",
		dftUseNodeConverter: config.default?.override?.converter === "node",
		dftGenerateDockerfile: config.default?.override?.generateDockerfile === true,
		dftUseDummyCache: config.default?.override?.incrementalCache === "dummy",
		dftUseDummyTagCache: config.default?.override?.tagCache === "dummy",
		dftUseDummyQueue: config.default?.override?.queue === "dummy",
		// Check for the middleware function
		mwIsMiddlewareExternal,
		mwUseCloudflareWrapper: mwConfig?.override?.wrapper === "cloudflare-edge",
		mwUseEdgeConverter: mwConfig?.override?.converter === "edge",
		mwUseFetchProxy: mwConfig?.override?.proxyExternalRequest === "fetch",
		hasCryptoExternal: config.edgeExternals?.includes("node:crypto"),
	};

	if (config.default?.override?.queue === "direct") {
		logger.warn("The direct mode queue is not recommended for use in production.");
	}

	const workerRequirements = [
		requirements.dftUseCloudflareWrapper,
		requirements.dftUseEdgeConverter,
		requirements.dftUseFetchProxy,
		requirements.dftMaybeUseCache,
		requirements.dftMaybeUseTagCache,
		requirements.dftMaybeUseQueue,
	];
	const containerRequirements = [
		requirements.dftUseNodeWrapper,
		requirements.dftUseNodeConverter,
		requirements.dftGenerateDockerfile,
		requirements.dftUseDummyCache,
		requirements.dftUseDummyTagCache,
		requirements.dftUseDummyQueue,
	];
	const commonRequirements = [
		requirements.mwIsMiddlewareExternal,
		requirements.mwUseCloudflareWrapper,
		requirements.mwUseEdgeConverter,
		requirements.mwUseFetchProxy,
		requirements.hasCryptoExternal,
	];

	if (
		![...(isContainer ? containerRequirements : workerRequirements), ...commonRequirements].every(Boolean)
	) {
		const workerErrorMessage =
			"The `open-next.config.ts` should have a default export like this:\n\n" +
			`{
          default: {
            override: {
              wrapper: "cloudflare-node",
              converter: "edge",
              proxyExternalRequest: "fetch",
              incrementalCache: "dummy" | function,
              tagCache: "dummy" | function,
              queue: "dummy" | "direct" | function,
            },
          },
          edgeExternals: ["node:crypto"],
          middleware: {
            external: true,
            override: {
              wrapper: "cloudflare-edge",
              converter: "edge",
              proxyExternalRequest: "fetch",
              incrementalCache: "dummy" | function,
              tagCache: "dummy" | function,
              queue: "dummy" | "direct" | function,
            },
          },
        }\n\n`.replace(/^ {8}/gm, "");
		const containerErrorMessage =
			"The `open-next.config.ts` should use this configuration for Cloudflare Containers:\n\n" +
			`{
          default: {
            override: {
              wrapper: "node",
              converter: "node",
              generateDockerfile: true,
              incrementalCache: "dummy",
              tagCache: "dummy",
              queue: "dummy",
            },
          },
          edgeExternals: ["node:crypto"],
          cloudflare: { container: true },
          middleware: {
            external: true,
            override: {
              wrapper: "cloudflare-edge",
              converter: "edge",
              proxyExternalRequest: "fetch",
            },
          },
        }\n\n`.replace(/^ {8}/gm, "");
		const errorMessage = isContainer ? containerErrorMessage : workerErrorMessage;
		if (config.cloudflare?.dangerousDisableConfigValidation) {
			logger.warn(errorMessage);
			return;
		}
		throw new Error(errorMessage);
	}
}
