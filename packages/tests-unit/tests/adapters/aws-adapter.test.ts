import createAwsAdapterOptions from "@opennextjs/aws/adapter.js";
import { describe, expect, it, vi } from "vitest";

const { buildAdapter } = vi.hoisted(() => ({
	buildAdapter: vi.fn((callback) => callback),
}));

vi.mock("@opennextjs/core/build/adapter.js", () => ({ buildAdapter }));

describe("AWS adapter", () => {
	it("routes server caching through the dedicated AWS cache function", () => {
		const createOptions = createAwsAdapterOptions as unknown as (
			config: unknown,
			buildOptions: unknown
		) => {
			defaultOverrides: Record<string, Record<string, string>>;
		};
		const { defaultOverrides } = createOptions({}, {});

		expect(defaultOverrides.server).toMatchObject({
			cache: "@opennextjs/core/overrides/cache/fetch.js",
		});
		expect(defaultOverrides.middleware).toMatchObject({
			cache: "@opennextjs/core/overrides/cache/fetch.js",
		});
		expect(defaultOverrides.cache).toEqual({
			wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
			converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
			incrementalCache: "@opennextjs/aws/overrides/incrementalCache/s3.js",
			tagCache: "@opennextjs/aws/overrides/tagCache/dynamodb.js",
		});
	});
});
