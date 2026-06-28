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
		expect(result.message).toMatch(/Splitted function broken must have at least one route/);
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
