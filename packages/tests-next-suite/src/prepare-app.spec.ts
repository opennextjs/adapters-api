import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";
import { parse } from "yaml";

import { prepareApp } from "./prepare-app.js";
import type { Target } from "./targets.js";

const target: Target = {
	name: "cloudflare",
	packages: ["@opennextjs/cloudflare", "@opennextjs/core"],
	extraDependencies: { wrangler: "^4.110.0" },
	templateFiles: ["open-next.config.ts", "wrangler.jsonc"],
	buildCommand: [],
	startCommand: () => [],
};

let appDir: string;
let tarballsDir: string;

function readPackageJson(): Record<string, any> {
	return JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
}

function readWorkspace(): Record<string, any> {
	return parse(fs.readFileSync(path.join(appDir, "pnpm-workspace.yaml"), "utf8"));
}

beforeEach(() => {
	appDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-app-"));
	tarballsDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-suite-tarballs-"));
	fs.writeFileSync(
		path.join(appDir, "package.json"),
		JSON.stringify({
			dependencies: { next: "16.2.1" },
			scripts: { build: "next build && pnpm post-build" },
		})
	);
	for (const name of ["opennextjs-cloudflare.tgz", "opennextjs-core.tgz"]) {
		fs.writeFileSync(path.join(tarballsDir, name), "");
	}
});

function prepare(): void {
	prepareApp({ appDir, target, tarballsDir, packageManager: "pnpm@11.25.0" });
}

describe("prepareApp", () => {
	test("adds tarball dependencies and pins transitive OpenNext packages through overrides", () => {
		prepare();

		const pkg = readPackageJson();
		expect(pkg.dependencies["@opennextjs/cloudflare"]).toBe(
			`file:${path.join(tarballsDir, "opennextjs-cloudflare.tgz")}`
		);
		expect(pkg.dependencies.wrangler).toBe("^4.110.0");
		expect(readWorkspace().overrides["@opennextjs/core"]).toBe(
			`file:${path.join(tarballsDir, "opennextjs-core.tgz")}`
		);
	});

	test("keeps the harness scripts and next version", () => {
		prepare();

		const pkg = readPackageJson();
		expect(pkg.scripts.build).toBe("next build && pnpm post-build");
		expect(pkg.dependencies.next).toBe("16.2.1");
	});

	test("sets packageManager and install policy", () => {
		prepare();

		expect(readPackageJson().packageManager).toBe("pnpm@11.25.0");
		const workspace = readWorkspace();
		expect(workspace.strictDepBuilds).toBe(false);
		expect(workspace.minimumReleaseAge).toBeUndefined();
		expect(workspace.allowBuilds).toMatchObject({ esbuild: true, sharp: true, workerd: true });
	});

	test("pins what the harness requests as latest to versions this Next.js supports", () => {
		prepare();

		const { overrides } = readWorkspace();
		expect(overrides.typescript).toBe("5.9.3");
		expect(overrides["@types/node"]).toBe("24.0.0");
	});

	test("adds a next.config when the test app has none, as the OpenNext build requires one", () => {
		prepare();

		expect(fs.readFileSync(path.join(appDir, "next.config.mjs"), "utf8")).toBe("export default {};\n");
	});

	test.each(["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"])(
		"keeps an existing %s",
		(file) => {
			fs.writeFileSync(path.join(appDir, file), "// from the test");

			prepare();

			expect(fs.readdirSync(appDir).filter((name) => name.startsWith("next.config"))).toEqual([file]);
			expect(fs.readFileSync(path.join(appDir, file), "utf8")).toBe("// from the test");
		}
	);

	test("merges into a pnpm-workspace.yaml shipped by the test app", () => {
		fs.writeFileSync(
			path.join(appDir, "pnpm-workspace.yaml"),
			"packages:\n  - app\noverrides:\n  foo: 1.0.0\n"
		);

		prepare();

		const workspace = readWorkspace();
		expect(workspace.packages).toEqual(["app"]);
		expect(workspace.overrides.foo).toBe("1.0.0");
		expect(workspace.overrides["@opennextjs/core"]).toBeDefined();
	});

	test("overwrites template files shipped by the test app", () => {
		fs.writeFileSync(path.join(appDir, "wrangler.jsonc"), "{}");

		prepare();

		expect(fs.readFileSync(path.join(appDir, "wrangler.jsonc"), "utf8")).toContain('"name": "next-suite"');
	});

	test("fails naming the tarball when it is missing", () => {
		fs.rmSync(path.join(tarballsDir, "opennextjs-core.tgz"));

		expect(prepare).toThrow(/@opennextjs\/core/);
	});
});
