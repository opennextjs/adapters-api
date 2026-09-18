import { describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	env: {
		API_SECRET: "secret",
		APP_ENV: "production",
		ASSETS: { fetch: vi.fn() },
		OPEN_NEXT_CONTAINER: { get: vi.fn() },
	},
}));

vi.mock("@cloudflare/containers", () => ({
	Container: class {},
	getContainer: vi.fn(),
}));

const { getContainerEnvVars, OpenNextContainer } = await import("./container.js");

describe("getContainerEnvVars", () => {
	test("keeps vars and secrets while excluding object bindings", () => {
		expect(
			getContainerEnvVars({
				API_SECRET: "secret",
				APP_ENV: "production",
				ASSETS: { fetch: vi.fn() },
				OPTIONAL_VALUE: undefined,
			})
		).toEqual({
			API_SECRET: "secret",
			APP_ENV: "production",
		});
	});
});

describe("OpenNextContainer", () => {
	test("passes string Worker bindings to the container process", () => {
		const container = new OpenNextContainer({} as never, {} as never);

		expect(container.envVars).toEqual({
			API_SECRET: "secret",
			APP_ENV: "production",
		});
	});
});
