import fs from "node:fs";
import path from "node:path";

import { parse, stringify } from "yaml";

import { PACKAGE_DIR, type Target } from "./targets.js";

const NEXT_CONFIG_FILES = ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"];

/**
 * Versions forced in the apps, where the harness asks for `latest`.
 *
 * Next.js 16.2 can not load TypeScript 7 and writes a tsconfig TypeScript 6 rejects.
 */
const PINNED_DEPENDENCIES = { typescript: "5.9.3", "@types/node": "24.0.0" };

export type PrepareAppOptions = {
	appDir: string;
	target: Target;
	tarballsDir: string;
	packageManager: string;
};

/** Returns the file name of a packed package, `@opennextjs/core` is packed to `opennextjs-core.tgz`. */
export function tarballName(packageName: string): string {
	return `${packageName.replace("@", "").replace("/", "-")}.tgz`;
}

function resolveTarballs(target: Target, tarballsDir: string): Record<string, string> {
	const entries = target.packages.map((name) => {
		const tarball = path.join(tarballsDir, tarballName(name));
		if (!fs.existsSync(tarball)) {
			throw new Error(`Missing tarball for ${name}: ${tarball}`);
		}
		return [name, `file:${tarball}`];
	});
	return Object.fromEntries(entries);
}

/**
 * Turns the app created by the harness into a project using the packed OpenNext packages.
 *
 * Packing replaces `workspace:*` with versions which are not published, so the tarballs are also set as
 * overrides for the dependencies between OpenNext packages to resolve.
 *
 * @param options The app, its target and how to install it.
 */
export function prepareApp({ appDir, target, tarballsDir, packageManager }: PrepareAppOptions): void {
	const tarballs = resolveTarballs(target, tarballsDir);

	const packageJsonPath = path.join(appDir, "package.json");
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	packageJson.packageManager = packageManager;
	packageJson.dependencies = { ...packageJson.dependencies, ...tarballs, ...target.extraDependencies };
	fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

	const workspacePath = path.join(appDir, "pnpm-workspace.yaml");
	const workspace = fs.existsSync(workspacePath) ? parse(fs.readFileSync(workspacePath, "utf8")) : {};
	fs.writeFileSync(
		workspacePath,
		stringify({
			...workspace,
			strictDepBuilds: false,
			minimumReleaseAge: 0,
			allowBuilds: { ...workspace.allowBuilds, esbuild: true, sharp: true, workerd: true },
			overrides: { ...workspace.overrides, ...PINNED_DEPENDENCIES, ...tarballs },
		})
	);

	if (!NEXT_CONFIG_FILES.some((file) => fs.existsSync(path.join(appDir, file)))) {
		fs.writeFileSync(path.join(appDir, "next.config.mjs"), "export default {};\n");
	}

	for (const file of target.templateFiles) {
		fs.copyFileSync(path.join(PACKAGE_DIR, "templates", target.name, file), path.join(appDir, file));
	}
}
