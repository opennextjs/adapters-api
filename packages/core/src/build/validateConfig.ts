import path from "node:path";

import type {
	FunctionOptions,
	IncludedConverter,
	IncludedWrapper,
	OpenNextConfig,
	SplittedFunctionOptions,
} from "@/types/open-next";

import { getDefaultConverterName, getDefaultWrapperName } from "../overrides/compatibility.js";
import type { BundleDefaults, DefaultOverrides } from "../plugins/resolve.js";

export type ValidateConfigResult =
	| { success: true }
	| {
			success: false;
			message: string;
			shouldThrow?: boolean;
			/** Logging level the caller should use when shouldThrow is false. Defaults to "warn". */
			level?: "warn" | "error";
	  };

const compatibilityMatrix: Record<IncludedWrapper, IncludedConverter[]> = {
	"aws-lambda": ["aws-apigw-v1", "aws-apigw-v2", "aws-cloudfront", "sqs-revalidate"],
	"aws-lambda-compressed": ["aws-apigw-v2"],
	"aws-lambda-streaming": ["aws-streaming"],
	cloudflare: ["edge"],
	"cloudflare-edge": ["edge"],
	"cloudflare-node": ["edge"],
	node: ["node"],
	"express-dev": ["node"],
	dummy: ["dummy", "edge"],
};

/**
 * Extracts a built-in override name from a package or file specifier.
 *
 * @param value Override name or module specifier.
 * @return The final filename without its extension.
 */
function normalizeOverrideName(value: string): string {
	// The Win32 parser recognizes both `\` and `/`, regardless of the host OS.
	return path.win32.parse(value).name;
}

/**
 * Validates wrapper and converter options for one function.
 *
 * @param fnOptions Function options to validate.
 * @return The first compatibility issue, or success.
 */
function validateFunctionOptions(
	fnOptions: FunctionOptions,
	defaultOverrides?: DefaultOverrides
): ValidateConfigResult {
	const configuredWrapper =
		typeof fnOptions.override?.wrapper === "string"
			? normalizeOverrideName(fnOptions.override.wrapper)
			: undefined;
	const configuredConverter =
		typeof fnOptions.override?.converter === "string"
			? normalizeOverrideName(fnOptions.override.converter)
			: undefined;
	const defaultWrapper = normalizeOverrideName(defaultOverrides?.wrapper ?? "aws-lambda");
	const wrapper =
		configuredWrapper ??
		(configuredConverter && getDefaultConverterName(defaultWrapper) === configuredConverter
			? defaultWrapper
			: configuredConverter
				? getDefaultWrapperName(configuredConverter)
				: undefined) ??
		defaultWrapper;
	const converter =
		configuredConverter ??
		(configuredWrapper ? getDefaultConverterName(configuredWrapper) : undefined) ??
		normalizeOverrideName(defaultOverrides?.converter ?? getDefaultConverterName(wrapper) ?? "aws-apigw-v2");
	if (fnOptions.override?.generateDockerfile && converter !== "node" && wrapper !== "node") {
		return {
			success: false,
			shouldThrow: false,
			level: "warn",
			message:
				"You've specified generateDockerfile without node converter and wrapper. Without custom converter and wrapper the dockerfile will not work",
		};
	}
	if (converter === "aws-cloudfront" && fnOptions.placement !== "global") {
		return {
			success: false,
			shouldThrow: false,
			level: "warn",
			message:
				"You've specified aws-cloudfront converter without global placement. This may not generate the correct output",
		};
	}
	const isCustomWrapper = typeof fnOptions.override?.wrapper === "function";
	const isCustomConverter = typeof fnOptions.override?.converter === "function";
	// Check if the wrapper and converter are compatible
	// Only check if using one of the included converters or wrapper
	const compatibleConverters = compatibilityMatrix[wrapper as IncludedWrapper];
	if (!compatibleConverters && !isCustomWrapper) {
		return {
			success: false,
			shouldThrow: false,
			level: "error",
			message: `Unknown wrapper ${wrapper}`,
		};
	}
	if (
		compatibleConverters &&
		!compatibleConverters.includes(converter as IncludedConverter) &&
		!isCustomWrapper &&
		!isCustomConverter
	) {
		return {
			success: false,
			shouldThrow: false,
			level: "error",
			message: `Wrapper ${wrapper} and converter ${converter} are not compatible. For the wrapper ${wrapper} you should only use the following converters: ${compatibleConverters.join(", ")}`,
		};
	}
	return { success: true };
}

/**
 * Validates one split function and its routes.
 *
 * @param fnOptions Split function options to validate.
 * @param name Function name used in diagnostics.
 * @return The first structural or compatibility issue, or success.
 */
function validateSplittedFunctionOptions(
	fnOptions: SplittedFunctionOptions,
	name: string,
	defaultOverrides?: DefaultOverrides
): ValidateConfigResult {
	if (fnOptions.routes.length === 0) {
		return {
			success: false,
			shouldThrow: true,
			message: `Split function ${name} must have at least one route`,
		};
	}
	// Check if the routes are properly formatted
	for (const route of fnOptions.routes) {
		if (!route.startsWith("app/") && !route.startsWith("pages/")) {
			return {
				success: false,
				shouldThrow: true,
				message: `Route ${route} in function ${name} is not valid. It should start with app/ or pages/, depending on whether you use the app or pages router`,
			};
		}
	}
	if (fnOptions.runtime === "edge" && fnOptions.routes.length > 1) {
		return {
			success: false,
			shouldThrow: true,
			message: `Edge function ${name} can only have one route`,
		};
	}
	return validateFunctionOptions(fnOptions, defaultOverrides);
}

/**
 * Validates an OpenNext configuration.
 *
 * Fatal structural issues take precedence over compatibility warnings so warnings cannot hide an invalid build.
 *
 * @param config OpenNext configuration to validate.
 * @param defaultOverrides Adapter-provided defaults used by each bundle type.
 * @return A fatal issue, the first nonfatal issue, or success.
 */
export function validateConfig(
	config: OpenNextConfig,
	defaultOverrides?: BundleDefaults
): ValidateConfigResult {
	const results: ValidateConfigResult[] = [validateFunctionOptions(config.default, defaultOverrides?.server)];
	for (const [name, fnOptions] of Object.entries(config.functions ?? {})) {
		results.push(
			validateSplittedFunctionOptions(
				fnOptions,
				name,
				fnOptions.placement === "global"
					? (defaultOverrides?.global ??
							(fnOptions.runtime === "edge" ? defaultOverrides?.edge : defaultOverrides?.server))
					: fnOptions.runtime === "edge"
						? defaultOverrides?.edge
						: defaultOverrides?.server
			)
		);
	}
	if (config.dangerous?.disableIncrementalCache) {
		results.push({
			success: false,
			shouldThrow: false,
			level: "warn",
			message: "You've disabled incremental cache. This means that ISR and SSG will not work.",
		});
	}
	if (config.dangerous?.disableTagCache) {
		results.push({
			success: false,
			shouldThrow: false,
			level: "warn",
			message: `You've disabled tag cache.
       This means that revalidatePath and revalidateTag from next/cache will not work.
       It is safe to disable if you only use page router`,
		});
	}
	results.push(validateFunctionOptions(config.imageOptimization ?? {}, defaultOverrides?.imageOptimization));
	if (config.middleware?.external === true) {
		const isNodeMiddleware = config.middleware.runtime === "node";
		results.push(
			validateFunctionOptions(config.middleware, {
				wrapper: isNodeMiddleware ? "node" : "dummy",
				converter: isNodeMiddleware ? "node" : "edge",
				...defaultOverrides?.middleware,
			})
		);
	}
	//@ts-expect-error - Revalidate custom wrapper type is different
	results.push(validateFunctionOptions(config.revalidate ?? {}, defaultOverrides?.revalidation));
	//@ts-expect-error - Warmer custom wrapper type is different
	results.push(validateFunctionOptions(config.warmer ?? {}, defaultOverrides?.warmer));
	results.push(validateFunctionOptions(config.initializationFunction ?? {}, defaultOverrides?.server));
	return (
		results.find((result) => !result.success && result.shouldThrow) ??
		results.find((result) => !result.success && result.level === "error") ??
		results.find((result) => !result.success) ?? { success: true }
	);
}
