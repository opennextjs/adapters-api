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
	Container: class {
		containerFetch = vi.fn(() => Promise.resolve(new Response()));
	},
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

	test("forwards the public request protocol to the Node.js server", async () => {
		const container = new OpenNextContainer({} as never, {} as never);

		await container.fetch(
			new Request("https://example.com/path", {
				headers: { "x-forwarded-proto": "http" },
			})
		);

		const init = vi.mocked(container.containerFetch).mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get("x-forwarded-proto")).toBe("https");
	});
});
