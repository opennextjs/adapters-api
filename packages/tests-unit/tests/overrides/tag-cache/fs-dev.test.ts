import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	default: { readFileSync: () => "[]" },
}));

globalThis.monorepoPackagePath = "";
const fsDevTagCache = (await import("@opennextjs/core/overrides/tagCache/fs-dev")).default;

describe("filesystem tag cache SWR revalidation", () => {
	beforeEach(() => {
		vi.useFakeTimers().setSystemTime(2_000);
	});

	it("serves a stale entry before its expiry", async () => {
		await fsDevTagCache.writeTags([
			{ path: "future-page", tag: "future-tag", stale: 2_000, expire: 3_000 },
		]);

		expect(await fsDevTagCache.getLastModified("future-page", 1_000)).toBe(1_000);
		expect(await fsDevTagCache.isStale?.("future-page", 1_000)).toBe(true);
	});

	it("hard-invalidates an entry after its expiry", async () => {
		await fsDevTagCache.writeTags([
			{ path: "expired-page", tag: "expired-tag", stale: 1_500, expire: 1_800 },
		]);

		expect(await fsDevTagCache.getLastModified("expired-page", 1_000)).toBe(-1);
	});

	it("serves a stale entry indefinitely when no expiry is set", async () => {
		await fsDevTagCache.writeTags([
			{ path: "indefinite-page", tag: "indefinite-tag", stale: 2_000 },
		]);

		expect(await fsDevTagCache.getLastModified("indefinite-page", 1_000)).toBe(1_000);
		expect(await fsDevTagCache.isStale?.("indefinite-page", 1_000)).toBe(true);
	});
});
