import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";

import { type Edit, Lang, parse } from "@ast-grep/napi";
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
};

export type OverrideKey = keyof typeof nameToFolder;
export type DefaultOverrides = Partial<Record<OverrideKey, string>>;

// Maps override key to resolve function name (docs / future ast-grep use)
const resolveFunctionName: Record<OverrideKey, string> = {
	wrapper: "resolveWrapper",
	converter: "resolveConverter",
	tagCache: "resolveTagCache",
	queue: "resolveQueue",
	incrementalCache: "resolveIncrementalCache",
	imageLoader: "resolveImageLoader",
	originResolver: "resolveOriginResolver",
	warmer: "resolveWarmerInvoke",
	proxyExternalRequest: "resolveProxyRequest",
	cdnInvalidation: "resolveCdnInvalidation",
};

// Relative-path fallback anchors matching the compiled resolve.js imports.
const resolveAnchors: Record<OverrideKey, string> = {
	wrapper: "../overrides/wrappers/node.js",
	converter: "../overrides/converters/node.js",
	tagCache: "../overrides/tagCache/fs-dev-nextMode.js",
	queue: "../overrides/queue/direct.js",
	incrementalCache: "../overrides/incrementalCache/fs-dev.js",
	imageLoader: "../overrides/imageLoader/fs-dev.js",
	originResolver: "../overrides/originResolver/pattern-env.js",
	warmer: "../overrides/warmer/dummy.js",
	proxyExternalRequest: "../overrides/proxyExternalRequest/node.js",
	cdnInvalidation: "../overrides/cdnInvalidation/dummy.js",
};

export type BundleType =
	| "server"
	| "middleware"
	| "edge"
	| "imageOptimization"
	| "revalidation"
	| "warmer"
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

				// Primary: ast-grep edits. Fallback: string-replace anchors (post-commit).
				const edits: Edit[] = [];
				const fallbackKeys: Array<{ key: OverrideKey; targetPath: string }> = [];
				const astRoot = parse(Lang.JavaScript, contents).root();

				for (const overrideName of allKeys) {
					const configValue = overrides?.[overrideName as keyof typeof overrides];
					const defaultValue = defaultValues?.[overrideName as keyof typeof defaultValues];
					let overrideValue = configValue ?? defaultValue;
					if (!overrideValue) {
						continue;
					}

					const key = overrideName as OverrideKey;
					const folder = nameToFolder[key];
					if (!folder) {
						continue;
					}

					if (overrideName === "wrapper" && overrideValue === "cloudflare") {
						overrideValue = "cloudflare-edge";
					}

					let targetPath: string;
					if (typeof overrideValue === "string") {
						if (isFullPath(overrideValue)) {
							try {
								const resolved = createRequire(args.path).resolve(overrideValue);
								targetPath = "./" + relative(dirname(args.path), resolved);
							} catch {
								targetPath = overrideValue;
							}
						} else {
							targetPath = `../overrides/${folder}/${overrideValue}.js`;
						}
					} else {
						targetPath = `@opennextjs/core/overrides/${folder}/dummy.js`;
					}

					// Primary: use ast-grep to find the resolve function by name
					// and replace the string inside `await import($PATH)`.
					const fnName_ = resolveFunctionName[key];
					try {
						const fnNode = astRoot.find({
							rule: {
								kind: "function_declaration",
								has: { kind: "identifier", pattern: fnName_ },
							},
						});
						if (fnNode) {
							const importNode = fnNode.find({
								rule: {
									kind: "string",
									inside: { kind: "await_expression", stopBy: "end" },
								},
							});
							if (importNode) {
								edits.push(importNode.replace('"' + targetPath + '"'));
								continue;
							}
						}
					} catch {
						// ast-grep lookup failed — fall through to fallback
					}
					fallbackKeys.push({ key, targetPath });
				}

				// Commit all ast-grep edits at once (no interleaving).
				if (edits.length > 0) {
					contents = astRoot.commitEdits(edits);
				}

				// Fallback: string-replace on post-commitEdits contents for any
				// keys ast-grep didn't handle.
				for (const fb of fallbackKeys) {
					const anchor = resolveAnchors[fb.key];
					if (anchor) {
						contents = contents.replace(anchor, fb.targetPath);
					}
				}

				return {
					contents,
				};
			});
		},
	};
}
