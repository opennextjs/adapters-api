import type {
	FunctionOptions,
	IncludedConverter,
	IncludedWrapper,
	OpenNextConfig,
	SplittedFunctionOptions,
} from "@/types/open-next";

export type ValidateConfigResult = {
	success: boolean;
	message?: string;
	shouldThrow?: boolean;
	/** Logging level the caller should use when shouldThrow is false. Defaults to "warn". */
	level?: "warn" | "error";
};

const compatibilityMatrix: Record<IncludedWrapper, IncludedConverter[]> = {
	"aws-lambda": ["aws-apigw-v1", "aws-apigw-v2", "aws-cloudfront", "sqs-revalidate"],
	"aws-lambda-compressed": ["aws-apigw-v2"],
	"aws-lambda-streaming": ["aws-apigw-v2"],
	cloudflare: ["edge"],
	"cloudflare-edge": ["edge"],
	"cloudflare-node": ["edge"],
	node: ["node"],
	"express-dev": ["node"],
	dummy: ["dummy"],
};

function validateFunctionOptions(fnOptions: FunctionOptions): ValidateConfigResult {
	// TODO: validateConfig needs to be updated to normalize full-path override strings to bare names before the compatibilityMatrix lookup (full-path user overrides currently crash L41)
	const wrapper = typeof fnOptions.override?.wrapper === "string" ? fnOptions.override.wrapper : "aws-lambda";
	const converter =
		typeof fnOptions.override?.converter === "string" ? fnOptions.override.converter : "aws-apigw-v2";
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
	if (!compatibilityMatrix[wrapper].includes(converter) && !isCustomWrapper && !isCustomConverter) {
		return {
			success: false,
			shouldThrow: false,
			level: "error",
			message: `Wrapper ${wrapper} and converter ${converter} are not compatible. For the wrapper ${wrapper} you should only use the following converters: ${compatibilityMatrix[
				wrapper
			].join(", ")}`,
		};
	}
	return { success: true };
}

function validateSplittedFunctionOptions(
	fnOptions: SplittedFunctionOptions,
	name: string
): ValidateConfigResult {
	const fnResult = validateFunctionOptions(fnOptions);
	if (!fnResult.success) return fnResult;
	if (fnOptions.routes.length === 0) {
		return {
			success: false,
			shouldThrow: true,
			message: `Splitted function ${name} must have at least one route`,
		};
	}
	// Check if the routes are properly formated
	for (const route of fnOptions.routes) {
		if (!route.startsWith("app/") && !route.startsWith("pages/")) {
			return {
				success: false,
				shouldThrow: true,
				message: `Route ${route} in function ${name} is not a valid route. It should starts with app/ or pages/ depending on if you use page or app router`,
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
	return { success: true };
}

export function validateConfig(config: OpenNextConfig): ValidateConfigResult {
	const defaultResult = validateFunctionOptions(config.default);
	if (!defaultResult.success) return defaultResult;
	for (const [name, fnOptions] of Object.entries(config.functions ?? {})) {
		const splittedResult = validateSplittedFunctionOptions(fnOptions, name);
		if (!splittedResult.success) return splittedResult;
	}
	if (config.dangerous?.disableIncrementalCache) {
		return {
			success: false,
			shouldThrow: false,
			level: "warn",
			message: "You've disabled incremental cache. This means that ISR and SSG will not work.",
		};
	}
	if (config.dangerous?.disableTagCache) {
		return {
			success: false,
			shouldThrow: false,
			level: "warn",
			message: `You've disabled tag cache.
       This means that revalidatePath and revalidateTag from next/cache will not work.
       It is safe to disable if you only use page router`,
		};
	}
	const imageOptimizationResult = validateFunctionOptions(config.imageOptimization ?? {});
	if (!imageOptimizationResult.success) return imageOptimizationResult;
	if (config.middleware?.external === true) {
		const middlewareResult = validateFunctionOptions(config.middleware ?? {});
		if (!middlewareResult.success) return middlewareResult;
	}
	//@ts-expect-error - Revalidate custom wrapper type is different
	const revalidateResult = validateFunctionOptions(config.revalidate ?? {});
	if (!revalidateResult.success) return revalidateResult;
	//@ts-expect-error - Warmer custom wrapper type is different
	const warmerResult = validateFunctionOptions(config.warmer ?? {});
	if (!warmerResult.success) return warmerResult;
	const initResult = validateFunctionOptions(config.initializationFunction ?? {});
	if (!initResult.success) return initResult;
	return { success: true };
}
