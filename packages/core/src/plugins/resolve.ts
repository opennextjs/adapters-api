import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import chalk from "chalk";
import type { Plugin } from "esbuild";

import type {
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
		cache?: OverrideOptions["cache"];
	};
	defaultOverrides?: DefaultOverrides;
	fnName?: string;
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
	cache: "cache",
};

export type OverrideKey = keyof typeof nameToFolder;
export type DefaultOverrides = Partial<Record<OverrideKey, string>>;

// `core/resolve.js` lazily imports every default override with a relative specifier
// of the form `../overrides/<folder>/<file>.js`, and each override key owns exactly
// one folder (see `nameToFolder`). Rewriting the specifier of a folder is therefore
// enough to swap in the configured override, whatever the default file is named.
const resolveModuleFilter = getCrossPlatformPathRegex("core/resolve.js");

/** Matches the specifier of the override lazily imported from the given folder. */
function getOverrideImportRegex(folder: string): RegExp {
	return new RegExp(String.raw`(["'])\.\./overrides/${folder}/[^"']+\1`);
}

export type BundleType =
	| "server"
	| "middleware"
	| "edge"
	| "imageOptimization"
	| "revalidation"
	| "warmer"
	| "cache"
	| "tagCache";
export type BundleDefaults = Partial<Record<BundleType, DefaultOverrides>>;

/**
 * Checks if a string is a full package-specifier path (starts with @ or contains /).
 * Bare names like "node", "edge", "aws-lambda" return false.
 */
function isFullPath(s: string): boolean {
	return s.startsWith("@") || s.includes("/");
}

/**
 * Turns a package specifier into a path relative to `core/resolve.js`, so that esbuild
 * resolves the override itself - it is the only way for it to pick up the module type
 * (`type: "module"`) of the package the override comes from.
 *
 * Overrides live in the adapter packages the app depends on, which are not necessarily
 * reachable from `core` itself (they are not, with an isolated node_modules layout), so
 * resolution is attempted from the app as well. The specifier is returned as-is when it
 * cannot be resolved, leaving esbuild to report the failure.
 */
function toRelativePath(specifier: string, resolvePath: string, appDir: string): string {
	for (const from of [resolvePath, join(appDir, "index.js")]) {
		try {
			const resolved = createRequire(from).resolve(specifier);
			return `./${relative(dirname(resolvePath), resolved).replaceAll("\\", "/")}`;
		} catch {
			// Not resolvable from there, try the next one
		}
	}
	return specifier;
}

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

			// Maps the overrides folder to the specifier that should be imported instead
			// of the default one. Computed once, the config cannot change during a build.
			const redirects = new Map<string, string>();
			const allKeys = new Set([...Object.keys(overrides ?? {}), ...Object.keys(defaultValues ?? {})]);

			for (const overrideName of allKeys) {
				const configValue = overrides?.[overrideName as keyof typeof overrides];
				const defaultValue = defaultValues?.[overrideName as keyof typeof defaultValues];
				let overrideValue = configValue ?? defaultValue;
				if (!overrideValue) {
					continue;
				}

				const folder = nameToFolder[overrideName as OverrideKey];
				if (!folder) {
					continue;
				}

				if (overrideName === "wrapper" && overrideValue === "cloudflare") {
					overrideValue = "cloudflare-edge";
				}

				if (typeof overrideValue !== "string") {
					// Lazy loaded overrides are inlined in the config, only the default
					// import has to be dropped - the dummy is never actually used.
					redirects.set(folder, `@opennextjs/core/overrides/${folder}/dummy.js`);
				} else if (isFullPath(overrideValue)) {
					redirects.set(folder, overrideValue);
				} else {
					redirects.set(folder, `../overrides/${folder}/${overrideValue}.js`);
				}
			}

			if (redirects.size === 0) {
				return;
			}

			const appDir = build.initialOptions.absWorkingDir ?? process.cwd();

			build.onLoad({ filter: resolveModuleFilter }, async (args) => {
				let contents = await readFile(args.path, "utf-8");

				for (const [folder, specifier] of redirects) {
					const targetPath = specifier.startsWith(".")
						? specifier
						: toRelativePath(specifier, args.path, appDir);
					logger.debug(chalk.blue(`Resolving the ${folder} override to "${targetPath}"`));
					// JSON encoded: the path can contain characters to escape (Windows separators)
					contents = contents.replace(getOverrideImportRegex(folder), () => JSON.stringify(targetPath));
				}

				return { contents };
			});
		},
	};
}
