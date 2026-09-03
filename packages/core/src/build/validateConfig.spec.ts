import { describe, test, expect } from "vitest";

import type { OpenNextConfig } from "../types/open-next.js";

import { validateConfig } from "./validateConfig.js";

describe("validateConfig", () => {
	test("returns success for minimal valid config", () => {
		const result = validateConfig({ default: {} } as OpenNextConfig);
		expect(result.success).toBe(true);
	});

	test("returns shouldThrow:true for splitted function with no routes", () => {
		const config = {
			default: {},
			functions: {
				broken: { routes: [], runtime: "edge" },
			},
		} as unknown as OpenNextConfig;
		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.shouldThrow).toBe(true);
		expect(result.message).toMatch(/Split function broken must have at least one route/);
	});

	test("returns shouldThrow:false for incompatible wrapper and converter", () => {
		const config = {
			default: { override: { wrapper: "aws-lambda", converter: "edge" } },
		} as unknown as OpenNextConfig;
		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.shouldThrow).toBe(false);
		expect(result.level).toBe("error");
		expect(result.message).toMatch(/not compatible/);
	});

	test("normalizes full-path wrapper and converter overrides", () => {
		const config = {
			default: {
				override: {
					wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda.js",
					converter: "@opennextjs/aws/overrides/converters/aws-apigw-v2.js",
				},
			},
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({ success: true });
	});

	test("defaults the AWS streaming wrapper to the streaming converter", () => {
		const config = {
			default: { override: { wrapper: "aws-lambda-streaming" } },
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({ success: true });
	});

	test("rejects an explicit incompatible converter for the AWS streaming wrapper", () => {
		const config = {
			default: {
				override: { wrapper: "aws-lambda-streaming", converter: "aws-apigw-v2" },
			},
		} as unknown as OpenNextConfig;

		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.message).toMatch(/not compatible/);
	});

	test("pairs partial overrides before applying adapter defaults", () => {
		const config = {
			default: { override: { wrapper: "aws-lambda" } },
		} as unknown as OpenNextConfig;
		expect(
			validateConfig(config, {
				server: {
					wrapper: "@opennextjs/aws/overrides/wrappers/aws-lambda-streaming.js",
					converter: "@opennextjs/aws/overrides/converters/aws-streaming.js",
				},
			})
		).toEqual({ success: true });
	});

	test.each([
		["C:\\overrides\\wrappers\\aws-lambda.cts", "C:\\overrides\\converters\\aws-apigw-v2.mts"],
		["/overrides/wrappers/aws-lambda.js", "/overrides/converters/aws-apigw-v2.mjs"],
	])("normalizes Windows and POSIX override paths", (wrapper, converter) => {
		const config = {
			default: { override: { wrapper, converter } },
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({ success: true });
	});

	test("does not validate a custom wrapper against the built-in compatibility matrix", () => {
		const config = {
			default: {
				override: {
					wrapper: async () => ({ name: "custom" }),
					converter: "edge",
				},
			},
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({ success: true });
	});

	test("preserves a compatible adapter wrapper for an ambiguous converter", () => {
		const config = {
			default: { override: { converter: "edge" } },
		} as unknown as OpenNextConfig;

		expect(
			validateConfig(config, {
				server: {
					wrapper: "@opennextjs/core/overrides/wrappers/cloudflare-node.js",
					converter: "@opennextjs/core/overrides/converters/edge.js",
				},
			})
		).toEqual({ success: true });
	});

	test.each([undefined, "node"] as const)("uses compatible %s external middleware defaults", (runtime) => {
		const config = {
			default: {},
			middleware: { external: true, runtime },
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({ success: true });
	});

	test("returns a descriptive issue for an unknown wrapper", () => {
		const config = {
			default: { override: { wrapper: "typo", converter: "aws-apigw-v2" } },
		} as unknown as OpenNextConfig;

		expect(validateConfig(config)).toEqual({
			success: false,
			shouldThrow: false,
			level: "error",
			message: "Unknown wrapper typo",
		});
	});

	test("returns a fatal route issue instead of an earlier warning", () => {
		const config = {
			default: { override: { generateDockerfile: true } },
			functions: {
				broken: { routes: [], runtime: "edge" },
			},
		} as unknown as OpenNextConfig;

		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.shouldThrow).toBe(true);
		expect(result.message).toMatch(/Split function broken/);
	});

	test("returns a compatibility error instead of an earlier warning", () => {
		const config = {
			default: { override: { generateDockerfile: true } },
			functions: {
				incompatible: {
					routes: ["app/page"],
					override: {
						wrapper: "aws-lambda-streaming",
						converter: "aws-apigw-v2",
					},
				},
			},
		} as unknown as OpenNextConfig;

		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.level).toBe("error");
		expect(result.message).toMatch(/not compatible/);
	});

	test("returns shouldThrow:false for disabled incremental cache warning", () => {
		const config = {
			default: {},
			dangerous: { disableIncrementalCache: true },
		} as unknown as OpenNextConfig;
		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.shouldThrow).toBe(false);
		expect(result.level).toBe("warn");
		expect(result.message).toMatch(/disabled incremental cache/);
	});

	test("returns shouldThrow:false for disabled tag cache warning", () => {
		const config = {
			default: {},
			dangerous: { disableTagCache: true },
		} as unknown as OpenNextConfig;
		const result = validateConfig(config);
		expect(result.success).toBe(false);
		expect(result.shouldThrow).toBe(false);
		expect(result.level).toBe("warn");
		expect(result.message).toMatch(/disabled tag cache/);
	});
});
