import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

export const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.dirname(path.dirname(PACKAGE_DIR));

export type TargetName = "core" | "cloudflare";

export type Target = {
	name: TargetName;
	/** Workspace packages installed in the app from their packed tarballs. */
	packages: string[];
	extraDependencies: Record<string, string>;
	/** Files copied from `templates/<name>/` to the app. */
	templateFiles: string[];
	buildCommand: string[];
	startCommand: (ports: { port: number; inspectorPort: number }) => string[];
	/** Makes the test-only variables visible to a runtime that does not inherit the process env. */
	prepareRuntimeEnv?: (appDir: string, testEnv: Record<string, string>) => void;
};

function readCatalogVersion(name: string): string {
	const workspace = parse(fs.readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8"));
	return workspace.catalog[name];
}

/** Quotes a value for `.dev.vars`, dotenv has no escapes: the only way is a quote the value does not hold. */
function quoteDevVar(value: string): string {
	const quote = ["'", "`", '"'].find((candidate) => !value.includes(candidate));
	if (!quote) {
		throw new Error(`Can not write a value holding all the quote characters to .dev.vars: ${value}`);
	}
	return `${quote}${value}${quote}`;
}

export const TARGETS: Record<TargetName, Target> = {
	core: {
		name: "core",
		packages: ["@opennextjs/aws", "@opennextjs/core"],
		extraDependencies: {},
		templateFiles: ["open-next.config.ts"],
		buildCommand: ["pnpm", "exec", "open-next", "build"],
		startCommand: () => ["node", ".open-next/server-functions/default/index.mjs"],
	},
	cloudflare: {
		name: "cloudflare",
		packages: ["@opennextjs/cloudflare", "@opennextjs/core"],
		extraDependencies: { wrangler: readCatalogVersion("wrangler") },
		templateFiles: ["open-next.config.ts", "wrangler.jsonc"],
		buildCommand: ["pnpm", "exec", "opennextjs-cloudflare", "build"],
		startCommand: ({ port, inspectorPort }) => [
			"pnpm",
			"exec",
			"opennextjs-cloudflare",
			"preview",
			"--port",
			String(port),
			"--inspector-port",
			String(inspectorPort),
		],
		prepareRuntimeEnv: (appDir, testEnv) => {
			const lines = Object.entries(testEnv).map(([key, value]) => `${key}=${quoteDevVar(value)}\n`);
			fs.writeFileSync(path.join(appDir, ".dev.vars"), lines.join(""));
		},
	},
};

/**
 * Resolves a target from its name.
 *
 * @param name The target name.
 * @returns The target.
 * @throws When the name is not a known target.
 */
export function getTarget(name: string | undefined): Target {
	if (name === undefined || !(name in TARGETS)) {
		throw new Error(`Unknown target "${name}", expected one of: ${Object.keys(TARGETS).join(", ")}`);
	}
	return TARGETS[name as TargetName];
}
