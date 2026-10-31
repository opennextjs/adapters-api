import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { toolchainEnv } from "./env.js";
import { tarballName } from "./prepare-app.js";
import { REPO_ROOT, TARGETS } from "./targets.js";

export const DEFAULT_NEXT_REF = "v16.2.1";

const NEXT_REPOSITORY = "https://github.com/vercel/next.js.git";
const REF_MARKER = ".next-suite-ref";

function run(cwd: string, command: string, ...args: string[]): void {
	execFileSync(command, args, { cwd, stdio: "inherit", env: toolchainEnv(process.env) });
}

/**
 * Makes sure `dir` holds a built Next.js checkout of `ref`.
 *
 * @param ref A tag, branch or commit of the Next.js repository.
 * @param dir The checkout directory, it is replaced when it holds another ref.
 */
export function ensureNextCheckout(ref: string, dir: string): void {
	const marker = path.join(dir, REF_MARKER);
	if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === ref) {
		return;
	}

	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	run(dir, "git", "init", "--quiet");
	run(dir, "git", "fetch", "--quiet", "--depth", "1", NEXT_REPOSITORY, ref);
	run(dir, "git", "checkout", "--quiet", "FETCH_HEAD");

	run(dir, "pnpm", "install");
	run(dir, "pnpm", "build");
	run(dir, "pnpm", "install");
	run(dir, "pnpm", "playwright", "install", "chromium");

	fs.writeFileSync(marker, ref);
}

/**
 * Builds the OpenNext packages and packs them the way they get published.
 *
 * @param outDir The directory receiving the tarballs, it is emptied first.
 */
export function packTarballs(outDir: string): void {
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });
	run(REPO_ROOT, "pnpm", "build:opennext");

	const packages = new Set(Object.values(TARGETS).flatMap((target) => target.packages));
	for (const name of packages) {
		const before = new Set(fs.readdirSync(outDir));
		run(REPO_ROOT, "pnpm", "--filter", name, "pack", "--pack-destination", outDir);
		const packed = fs.readdirSync(outDir).find((file) => !before.has(file));
		if (!packed) {
			throw new Error(`Packing ${name} produced no tarball in ${outDir}`);
		}
		fs.renameSync(path.join(outDir, packed), path.join(outDir, tarballName(name)));
	}
}
