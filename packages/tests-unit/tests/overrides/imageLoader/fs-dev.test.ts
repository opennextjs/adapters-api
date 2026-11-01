import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";

import loader from "@opennextjs/core/overrides/imageLoader/fs-dev.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { root } = vi.hoisted(() => ({ root: { dir: "" } }));

vi.mock("@opennextjs/core/adapters/config/index.js", () => ({ NextConfig: {} }));
vi.mock("@opennextjs/core/utils/normalize-path.js", () => ({
	getMonorepoRelativePath: () => root.dir,
}));

describe("fs-dev image loader", () => {
	beforeEach(() => {
		root.dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-dev-loader-"));
		fs.mkdirSync(path.join(root.dir, "assets"));
	});

	it("loads an image from the assets", async () => {
		fs.writeFileSync(path.join(root.dir, "assets/a.png"), "image");

		const { body, contentType } = await loader.load("/a.png");

		expect(await text(body!)).toBe("image");
		expect(contentType).toBe("image/png");
	});

	it("rejects for a missing image instead of emitting an error nothing handles", async () => {
		await expect(loader.load("/missing.png")).rejects.toThrow(/ENOENT/);
	});
});
