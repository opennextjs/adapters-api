import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

import { compileOpenNextConfig } from "@opennextjs/aws/build/compileConfig.js";
import { normalizeOptions } from "@opennextjs/aws/build/helper.js";
import { printHeader, showWarningOnWindows } from "@opennextjs/aws/build/utils.js";
import logger from "@opennextjs/aws/logger.js";
import { unstable_readConfig } from "wrangler";
import type yargs from "yargs";

import type { OpenNextConfig } from "../../../api/config.js";
import { createOpenNextConfigIfNotExistent } from "../../build/utils/create-config-files.js";
import { ensureCloudflareConfig } from "../../build/utils/ensure-cf-config.js";

export type WithWranglerArgs<T = unknown> = T & {
	wranglerArgs: string[];
	wranglerConfigPath: string | undefined;
	env: string | undefined;
};

export const nextAppDir = process.cwd();

export function printHeaders(command: string) {
	printHeader(`Cloudflare ${command}`);

	showWarningOnWindows();
}

export async function compileConfig(configPath: string | undefined) {
	if (configPath && !existsSync(configPath)) {
		throw new Error(`Custom config file not found at ${configPath}`);
	}

	if (!configPath) {
		configPath = await createOpenNextConfigIfNotExistent(nextAppDir);
	}

	const { config, buildDir } = await compileOpenNextConfig(configPath, { compileEdge: true });
	ensureCloudflareConfig(config);

	return { config, buildDir };
}

export async function retrieveCompiledConfig() {
	const configPath = path.join(nextAppDir, ".open-next/.build/open-next.config.edge.mjs");

	if (!existsSync(configPath)) {
		logger.error("Could not find compiled Open Next config, did you run the build command?");
		process.exit(1);
	}

	const config = await import(url.pathToFileURL(configPath).href).then((mod) => mod.default);
	ensureCloudflareConfig(config);

	return { config };
}

export function getNormalizedOptions(config: OpenNextConfig, buildDir = nextAppDir) {
	const require = createRequire(import.meta.url);
	const openNextDistDir = path.dirname(require.resolve("@opennextjs/aws/index.js"));

	const options = normalizeOptions(config, openNextDistDir, buildDir);
	logger.setLevel(options.debug ? "debug" : "info");

	return options;
}

export async function readWranglerConfig(args: WithWranglerArgs) {
	return await unstable_readConfig({ env: args.env, config: args.wranglerConfigPath });
}

export function withWranglerOptions<T extends yargs.Argv>(args: T) {
	return args
		.option("config", {
			type: "string",
			alias: "c",
			desc: "Path to Wrangler configuration file",
		})
		.option("configPath", {
			type: "string",
			desc: "Path to Wrangler configuration file",
			deprecated: true,
		})
		.option("env", {
			type: "string",
			alias: "e",
			desc: "Wrangler environment to use for operations",
		});
}

type WranglerInputArgs = {
	configPath: string | undefined;
	config: string | undefined;
	env: string | undefined;
	remote?: boolean | undefined;
};

function getWranglerArgs(
	args: WranglerInputArgs & {
		_: (string | number)[];
		args?: (string | number)[];
	}
): string[] {
	if (args.configPath) {
		logger.warn("The `--configPath` flag is deprecated, please use `--config` instead.");

		if (args.config) {
			logger.error(
				"Multiple config flags found. Please use the `--config` flag for your Wrangler config path."
			);
			process.exit(1);
		}
	}

	return [
		...(args.configPath ? ["--config", args.configPath] : []),
		...(args.config ? ["--config", args.config] : []),
		...(args.env ? ["--env", args.env] : []),
		...(args.remote ? ["--remote"] : []),
		...(args.args?.map((a) => `${a}`) ?? []),
	];
}

export function withWranglerPassthroughArgs<T extends yargs.ArgumentsCamelCase<WranglerInputArgs>>(
	args: T
): WithWranglerArgs<T> {
	return {
		...args,
		wranglerConfigPath: args.config ?? args.configPath,
		wranglerArgs: getWranglerArgs(args),
	};
}
