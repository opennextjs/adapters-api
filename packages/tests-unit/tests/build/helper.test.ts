import fs from "node:fs";

import { compareSemver, findNextConfig } from "@opennextjs/aws/build/helper.js";
import { afterEach, vi } from "vitest";

vi.mock("node:fs");

// We don't need to test canary versions, they are stripped out
describe("compareSemver", () => {
	test("=", () => {
		expect(compareSemver("1.0.0", "=", "1.0.0")).toBe(true);
		expect(compareSemver("1.1.0", "=", "1.0.0")).toBe(false);
		expect(compareSemver("1.0.1", "=", "1.0.0")).toBe(false);
	});

	it(">", () => {
		expect(compareSemver("1.0.1", ">", "1.0.0")).toBe(true);
		expect(compareSemver("1.0.0", ">", "1.0.0")).toBe(false);
		expect(compareSemver("1.0.0", ">", "1.0.1")).toBe(false);
	});

	it(">=", () => {
		expect(compareSemver("1.0.1", ">=", "1.0.0")).toBe(true);
		expect(compareSemver("1.0.0", ">=", "1.0.0")).toBe(true);
		expect(compareSemver("1.0.0", ">=", "1.0.1")).toBe(false);
	});

	it("<", () => {
		expect(compareSemver("1.0.0", "<", "1.0.1")).toBe(true);
		expect(compareSemver("1.0.0", "<", "1.0.0")).toBe(false);
		expect(compareSemver("1.0.0", "<", "0.0.1")).toBe(false);
	});

	it("<=", () => {
		expect(compareSemver("1.0.0", "<=", "1.0.1")).toBe(true);
		expect(compareSemver("1.0.0", "<=", "1.0.0")).toBe(true);
		expect(compareSemver("1.0.0", "<=", "0.0.1")).toBe(false);
	});

	test("latest", () => {
		expect(compareSemver("latest", "=", "1.0.0")).toBe(false);
		expect(compareSemver("latest", ">=", "1.0.0")).toBe(true);
		expect(compareSemver("latest", ">", "1.0.0")).toBe(true);
		expect(compareSemver("latest", "<=", "1.0.0")).toBe(false);
		expect(compareSemver("latest", "<", "1.0.0")).toBe(false);
	});

	test("incomplete version for patch", () => {
		expect(compareSemver("14.1.0", "=", "14.1")).toBe(true);
		expect(compareSemver("14.1", "=", "14.1.0")).toBe(true);
	});

	test("incomplete version for minor", () => {
		expect(compareSemver("14.0.0", "=", "14")).toBe(true);
		expect(compareSemver("14", "=", "14.0.0")).toBe(true);
	});

	test("throw if the major version is missing", () => {
		expect(() => compareSemver("incorrect", "=", "14.0.0")).toThrow();
		expect(() => compareSemver("14.0.0", "=", "latest")).toThrow();
	});

	test("throw if the major version is missing", () => {
		expect(() => compareSemver("incorrect", "=", "14.0.0")).toThrow();
		expect(() => compareSemver("14.0.0", "=", "latest")).toThrow();
	});

	test("throw if the operator is not supported", () => {
		expect(() => compareSemver("14.0.0", "==" as any, "14.0.0")).toThrow();
		expect(() => compareSemver("14.0.0", "!=" as any, "14.0.0")).toThrow();
	});
});

describe("findNextConfig", () => {
	const appPath = "/test/app";

	beforeEach(() => {
		vi.mocked(fs.existsSync).mockReset();
	});

	test("returns next.config.js when it exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === "/test/app/next.config.js");

		expect(findNextConfig({ appPath })).toEqual({
			path: "/test/app/next.config.js",
			isTypescript: false,
		});
	});

	test("returns next.config.cjs when it exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === "/test/app/next.config.cjs");

		expect(findNextConfig({ appPath })).toEqual({
			path: "/test/app/next.config.cjs",
			isTypescript: false,
		});
	});

	test("returns next.config.mjs when it exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === "/test/app/next.config.mjs");

		expect(findNextConfig({ appPath })).toEqual({
			path: "/test/app/next.config.mjs",
			isTypescript: false,
		});
	});

	test("returns next.config.ts when it exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === "/test/app/next.config.ts");

		expect(findNextConfig({ appPath })).toEqual({
			path: "/test/app/next.config.ts",
			isTypescript: true,
		});
	});

	test("returns undefined when no config file exists", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		expect(findNextConfig({ appPath })).toBeUndefined();
	});

	test("returns one of matching extension when multiple configs exist", () => {
		vi.mocked(fs.existsSync).mockImplementation(
			(filePath) => filePath === "/test/app/next.config.js" || filePath === "/test/app/next.config.ts"
		);

		expect(findNextConfig({ appPath })).toEqual({
			path: "/test/app/next.config.ts",
			isTypescript: true,
		});
	});
});
