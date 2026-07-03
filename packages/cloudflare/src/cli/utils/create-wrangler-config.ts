import assert from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findPackagerAndRoot } from "@opennextjs/core/build/helper.js";
import Cloudflare from "cloudflare";
import { type CommentObject, parse, stringify } from "comment-json";

import { getPackageTemplatesDirPath } from "../../utils/get-package-templates-dir-path.js";

import { askAccountSelection } from "./ask-account-selection.js";

export type PackagerDetails = {
	packager: "npm" | "pnpm" | "yarn" | "bun";
	monorepoRoot: string;
};

export function findWranglerConfig(appDir: string): string | undefined {
	const possibleExts = ["toml", "json", "jsonc"];

	for (const ext of possibleExts) {
		const path = join(appDir, `wrangler.${ext}`);
		if (existsSync(path)) {
			return path;
		}
	}

	return undefined;
}

export async function createWranglerConfigFile(
	projectDir: string,
	defaultCompatDate = "2026-02-01"
): Promise<{ cachingEnabled: boolean }> {
	const workerName = getWorkerName(projectDir);
	const compatibilityDate = (await getLatestCompatDate()) ?? defaultCompatDate;

	const wranglerConfigStr = readFileSync(join(getPackageTemplatesDirPath(), "wrangler.jsonc"), "utf8")
		.replaceAll("<WORKER_NAME>", workerName)
		.replaceAll("<COMPATIBILITY_DATE>", compatibilityDate);

	const wranglerConfig = parse(wranglerConfigStr) as CommentObject;

	assert(Array.isArray(wranglerConfig.r2_buckets));
	assert(wranglerConfig.r2_buckets[0] != null && typeof wranglerConfig.r2_buckets[0] === "object");
	assert(
		"bucket_name" in wranglerConfig.r2_buckets[0] &&
			typeof wranglerConfig.r2_buckets[0].bucket_name === "string"
	);

	const bucketName = wranglerConfig.r2_buckets[0].bucket_name.replaceAll(
		"<BUCKET_NAME>",
		`${workerName}-opennext-cache`
	);
	wranglerConfig.r2_buckets[0].bucket_name = bucketName;

	const { success: cachingEnabled } = await maybeCreateR2Bucket(projectDir, bucketName);

	if (!cachingEnabled) {
		delete wranglerConfig.r2_buckets;
	}

	writeFileSync(join(projectDir, "wrangler.jsonc"), stringify(wranglerConfig, null, "\t"));

	return { cachingEnabled };
}

function getWorkerName(projectDir: string): string {
	const appName = getNameFromPackageJson(projectDir) ?? "app-name";

	return appName
		.toLowerCase()
		.replace(/^@[^/]+\//, "")
		.replaceAll("_", "-")
		.replace(/[^a-z0-9-]/g, "");
}

function getNameFromPackageJson(sourceDir: string): string | undefined {
	try {
		const packageJsonStr = readFileSync(join(sourceDir, "package.json"), "utf8");
		const packageJson: Record<string, string> = JSON.parse(packageJsonStr);
		if (typeof packageJson.name === "string") return packageJson.name;
	} catch {
		/* empty */
	}
}

async function getLatestCompatDate(): Promise<string | undefined> {
	try {
		const resp = await fetch(`https://registry.npmjs.org/workerd`);
		const latestWorkerdVersion = (
			(await resp.json()) as {
				"dist-tags": { latest: string };
			}
		)["dist-tags"].latest;

		const match = latestWorkerdVersion.match(/\d+\.(\d{4})(\d{2})(\d{2})\.\d+/);

		if (match) {
			const [, year, month, day] = match;
			const compatDate = `${year}-${month}-${day}`;

			const currentDate = new Date().toISOString().slice(0, 10);

			return compatDate < currentDate ? compatDate : currentDate;
		}
	} catch {
		/* empty */
	}
}

async function maybeCreateR2Bucket(projectDir: string, bucketName: string): Promise<{ success: boolean }> {
	const { packager, root: monorepoRoot } = findPackagerAndRoot(projectDir);
	const packagerDetails: PackagerDetails = { packager, monorepoRoot };

	const authResult = runWrangler(packagerDetails, ["whoami", "--json"], { logging: "none" });

	if (!authResult.success) {
		return { success: false };
	}

	let whoami: {
		api_token: string;
		auth_status: string;
		email: string;
		accounts: { id: string; name: string }[];
	};

	try {
		whoami = JSON.parse(authResult.stdout);
	} catch {
		return { success: false };
	}

	if (whoami.auth_status !== "active") {
		return { success: false };
	}

	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await selectAccount(whoami.accounts));

	if (!accountId) {
		return { success: false };
	}

	const cf = new Cloudflare({ apiToken: whoami.api_token });

	try {
		await cf.r2.buckets.get(bucketName, { account_id: accountId });
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "MISSING_ARG_REGION") {
			try {
				await cf.r2.buckets.create({ account_id: accountId, name: bucketName });
			} catch {
				return { success: false };
			}
		} else if (error instanceof Error && error.message.includes("NotFound")) {
			try {
				await cf.r2.buckets.create({ account_id: accountId, name: bucketName });
			} catch {
				return { success: false };
			}
		} else {
			return { success: false };
		}
	}

	return { success: true };
}

async function selectAccount(accounts: { id: string; name: string }[]): Promise<string | undefined> {
	if (accounts.length === 0) {
		return undefined;
	}

	if (accounts.length === 1) {
		return accounts[0]!.id;
	}

	return askAccountSelection(accounts);
}

type WranglerCommandResult = {
	success: boolean;
	stdout: string;
	stderr: string;
};

type WranglerOptions = {
	target?: "local" | "remote";
	environment?: string;
	configPath?: string;
	logging?: "all" | "error" | "none";
	env?: Record<string, string>;
};

function runWrangler(
	options: PackagerDetails,
	args: string[],
	wranglerOpts: WranglerOptions = {}
): WranglerCommandResult {
	const { spawnSync } = require("node:child_process");

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

function injectPassthroughFlagForArgs(options: PackagerDetails, args: string[]): string[] {
	if (options.packager !== "npm" && options.packager !== "yarn") {
		return args;
	}

	const flagInArgsIndex = args.findIndex((v) => v.startsWith("--"));
	if (flagInArgsIndex !== -1) {
		args.splice(flagInArgsIndex, 0, "--");
	}

	return args;
}
