import { readFile } from "node:fs/promises";

import chalk from "chalk";
import type { Plugin } from "esbuild";

import type {
	BaseOverride,
	DefaultOverrideOptions,
	IncludedImageLoader,
	IncludedOriginResolver,
	IncludedWarmer,
	LazyLoadedOverride,
	OverrideOptions,
} from "@/types/open-next";
import type { ImageLoader, OriginResolver, Warmer } from "@/types/overrides";

import logger from "../logger.js";
import { getCrossPlatformPathRegex } from "../utils/regex.js";

export interface IPluginSettings {
	overrides?: {
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any - generic overrides for flexibility
		wrapper?: DefaultOverrideOptions<any, any>["wrapper"];
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any - generic overrides for flexibility
		converter?: DefaultOverrideOptions<any, any>["converter"];
		tagCache?: OverrideOptions["tagCache"];
		queue?: OverrideOptions["queue"];
		incrementalCache?: OverrideOptions["incrementalCache"];
		imageLoader?: LazyLoadedOverride<ImageLoader> | IncludedImageLoader;
		originResolver?: LazyLoadedOverride<OriginResolver> | IncludedOriginResolver;
		warmer?: LazyLoadedOverride<Warmer> | IncludedWarmer;
		proxyExternalRequest?: OverrideOptions["proxyExternalRequest"];
		cdnInvalidation?: OverrideOptions["cdnInvalidation"];
	};
	defaultOverrides?: DefaultOverrides;
	fnName?: string;
}

function getOverrideOrDummy<Override extends string | LazyLoadedOverride<BaseOverride>>(override: Override) {
	if (typeof override === "string") {
		return override;
	}
	// We can return dummy here because if it's not a string, it's a LazyLoadedOverride
	return "dummy";
}

// This could be useful in the future to map overrides to nested folders
const nameToFolder = {
	wrapper: "wrappers",
	converter: "converters",
	tagCache: "tagCache",
	queue: "queue",
	incrementalCache: "incrementalCache",
	imageLoader: "imageLoader",
	originResolver: "originResolver",
	warmer: "warmer",
	proxyExternalRequest: "proxyExternalRequest",
	cdnInvalidation: "cdnInvalidation",
};

export type OverrideKey = keyof typeof nameToFolder;
export type DefaultOverrides = Partial<Record<OverrideKey, string>>;

export type BundleType =
	| "server"
	| "middleware"
	| "edge"
	| "imageOptimization"
	| "revalidation"
	| "warmer"
	| "tagCache";
export type BundleDefaults = Partial<Record<BundleType, DefaultOverrides>>;

const coreResolveDefaults = {
	wrapper: "node",
	converter: "node",
	tagCache: "fs-dev-nextMode",
	queue: "direct",
	incrementalCache: "fs-dev",
	imageLoader: "fs-dev",
	originResolver: "pattern-env",
	warmer: "dummy",
	proxyExternalRequest: "node",
	cdnInvalidation: "dummy",
};

/**
 * @param opts.overrides - The name of the overrides to use
 * @returns
 */
export function openNextResolvePlugin({
	overrides,
	defaultOverrides: defaultValues,
	fnName,
}: IPluginSettings): Plugin {
	return {
		name: "opennext-resolve",
		setup(build) {
			logger.debug(chalk.blue("OpenNext Resolve plugin"), fnName ? `for ${fnName}` : "");
			build.onLoad({ filter: getCrossPlatformPathRegex("core/resolve.js") }, async (args) => {
				let contents = await readFile(args.path, "utf-8");
				const allKeys = new Set([...Object.keys(overrides ?? {}), ...Object.keys(defaultValues ?? {})]);
				for (const overrideName of allKeys) {
					const configValue = overrides?.[overrideName as keyof typeof overrides];
					const defaultValue = defaultValues?.[overrideName as keyof typeof defaultValues];
					let overrideValue = configValue ?? defaultValue;
					if (!overrideValue) {
						continue;
					}
					if (overrideName === "wrapper" && overrideValue === "cloudflare") {
						// "cloudflare" is deprecated and replaced by "cloudflare-edge".
						overrideValue = "cloudflare-edge";
					}
					const folder = nameToFolder[overrideName as keyof typeof nameToFolder];
					const searchTarget = coreResolveDefaults[overrideName as keyof typeof coreResolveDefaults];
					if (!folder || !searchTarget) {
						continue;
					}
					contents = contents.replace(
						`../overrides/${folder}/${searchTarget}.js`,
						`../overrides/${folder}/${getOverrideOrDummy(overrideValue)}.js`
					);
				}
				return {
					contents,
				};
			});
		},
	};
}
