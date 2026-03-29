import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { compareSemver } from "@opennextjs/aws/build/helper.js";

export type PackagerDetails = {
	packager: "npm" | "pnpm" | "yarn" | "bun";
	monorepoRoot: string;
};

export type WranglerTarget = "local" | "remote";

export type WranglerCommandResult = {
	success: boolean;
	stdout: string;
	stderr: string;
};

type WranglerOptions = {
	target?: WranglerTarget;
	environment?: string;
	configPath?: string;
	logging?: "all" | "error" | "none";
	env?: Record<string, string>;
};

function isYarnModern(monorepoRoot: string) {
	const packageJson: { packageManager?: string } = JSON.parse(
		readFileSync(path.join(monorepoRoot, "package.json"), "utf8")
	);

	if (!packageJson.packageManager?.startsWith("yarn")) return false;

	const [, version] = packageJson.packageManager.split("@");
	return version ? compareSemver(version, ">=", "4.0.0") : false;
}

function injectPassthroughFlagForArgs(options: PackagerDetails, args: string[]) {
	if (options.packager !== "npm" && (options.packager !== "yarn" || isYarnModern(options.monorepoRoot))) {
		return args;
	}

	const flagInArgsIndex = args.findIndex((v) => v.startsWith("--"));
	if (flagInArgsIndex !== -1) {
		args.splice(flagInArgsIndex, 0, "--");
	}

	return args;
}

export function runWrangler(
	options: PackagerDetails,
	args: string[],
	wranglerOpts: WranglerOptions = {}
): WranglerCommandResult {
	const noLogs = wranglerOpts.logging === "none";
	const shouldPipeLogs = wranglerOpts.logging === "error";

	const result = spawnSync(
		options.packager,
		[
			options.packager === "bun" ? "x" : "exec",
			"wrangler",
			...injectPassthroughFlagForArgs(
				options,
				[
					...args,
					wranglerOpts.environment && `--env ${wranglerOpts.environment}`,
					wranglerOpts.configPath && `--config ${wranglerOpts.configPath}`,
					wranglerOpts.target === "remote" && "--remote",
					wranglerOpts.target === "local" && "--local",
				].filter((v): v is string => !!v)
			),
		],
		{
			shell: true,
			stdio: shouldPipeLogs || noLogs ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "pipe"],
			env: {
				...process.env,
				...wranglerOpts.env,
				CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
			},
		}
	);

	const success = result.status === 0;
	const stdout = result.stdout?.toString() ?? "";
	const stderr = result.stderr?.toString() ?? "";

	if (!noLogs) {
		if (!shouldPipeLogs && stderr) {
			process.stderr.write(stderr);
		}

		if (!success && shouldPipeLogs) {
			process.stdout.write(stdout);
			process.stderr.write(stderr);
		}
	}

	return { success, stdout, stderr };
}

export function isWranglerTarget(v: string | undefined): v is WranglerTarget {
	return !!v && ["local", "remote"].includes(v);
}
