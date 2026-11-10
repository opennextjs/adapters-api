import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/core/adapters/config/index.js", () => ({
	BuildId: "",
	FunctionsConfigManifest: { functions: {} },
	HtmlPages: [],
	MiddlewareManifest: { functions: {}, middleware: {} },
	NextConfig: {},
	PrerenderManifest: { routes: {}, dynamicRoutes: {} },
	RoutingConfig: {
		routes: {
			beforeMiddleware: [],
			beforeFiles: [],
			afterFiles: [],
			dynamicRoutes: [],
			onMatch: [],
			fallback: [],
		},
	},
}));

describe("requestHandler", () => {
	const original = globalThis.AsyncLocalStorage;

	beforeEach(() => {
		// @ts-expect-error - Next.js expects it on the global object, apps without middleware have to get it here
		delete globalThis.AsyncLocalStorage;
		vi.resetModules();
	});

	afterEach(() => {
		globalThis.AsyncLocalStorage = original;
	});

	it("defines the global AsyncLocalStorage the Next.js runtime needs", async () => {
		await import("@opennextjs/core/core/requestHandler.js");

		expect(globalThis.AsyncLocalStorage).toBeTypeOf("function");
	});
});
