import adapterCallback from "@opennextjs/aws/adapter.js";
import { describe, expect, test, vi } from "vitest";

const buildAdapter = vi.hoisted(() => vi.fn((callback) => callback));

vi.mock("@opennextjs/core/build/adapter.js", () => ({
	buildAdapter,
}));

describe("AWS adapter cache defaults", () => {
	test("builds the cache handler as an AWS Lambda backed by shared caches", () => {
		const options = (
			adapterCallback as unknown as (
				_config: unknown,
				buildOptions: unknown
			) => {
				defaultOverrides: { cache: Record<string, string> };
			}
		)({}, {});

		expect(options.defaultOverrides.cache).toEqual({
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
			tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
		});
	});
});
