import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { copyPackageCliFiles } from "./copy-package-cli-files.js";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("copyPackageCliFiles", () => {
	test("writes the container Worker entrypoint when requested", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "opennext-container-"));
		tempDirectories.push(root);
		const templatesDir = path.join(root, "cli", "templates");
		const outputDir = path.join(root, "output");
		await mkdir(templatesDir, { recursive: true });
		await writeFile(path.join(templatesDir, "container.js"), "container worker");
		await writeFile(path.join(templatesDir, "worker.js"), "standard worker");

		copyPackageCliFiles(root, { outputDir } as never, "container");

		expect(await readFile(path.join(outputDir, "worker.container.js"), "utf8")).toBe("container worker");
	});
});
