/**
 * Returns the conventional converter for a built-in wrapper.
 *
 * @param wrapper - The normalized built-in wrapper name.
 * @returns The paired converter name, if the wrapper is known.
 */
export function getDefaultConverterName(wrapper: string): string | undefined {
	switch (wrapper) {
		case "aws-lambda":
		case "aws-lambda-compressed":
			return "aws-apigw-v2";
		case "aws-lambda-streaming":
			return "aws-streaming";
		case "cloudflare":
		case "cloudflare-edge":
		case "cloudflare-node":
			return "edge";
		case "node":
		case "express-dev":
			return "node";
		case "dummy":
			return "dummy";
	}
}

/**
 * Returns the conventional wrapper for a built-in converter.
 *
 * @param converter - The normalized built-in converter name.
 * @returns The paired wrapper name, if the converter is known.
 */
export function getDefaultWrapperName(converter: string): string | undefined {
	switch (converter) {
		case "aws-apigw-v1":
		case "aws-apigw-v2":
		case "aws-cloudfront":
		case "sqs-revalidate":
			return "aws-lambda";
		case "aws-streaming":
			return "aws-lambda-streaming";
		case "edge":
			return "cloudflare-edge";
		case "node":
			return "node";
		case "dummy":
			return "dummy";
	}
}
