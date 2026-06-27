import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import url from "node:url";

import { compileOpenNextConfig } from "@opennextjs/core/build/compileConfig.js";
import { normalizeOptions } from "@opennextjs/core/build/helper.js";
import { printHeader, showWarningOnWindows } from "@opennextjs/core/build/utils.js";
import logger from "@opennextjs/core/logger.js";
import { unstable_readConfig } from "wrangler";
import type yargs from "yargs";

import type { OpenNextConfig } from "../../../api/config.js";
import { ensureCloudflareConfig } from "../../build/utils/ensure-cf-config.js";
import { askConfirmation } from "../../utils/ask-confirmation.js";
import { createOpenNextConfigFile, findOpenNextConfig } from "../../utils/create-open-next-config.js";

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

/**
 * Compile the OpenNext config file.
 *
 * When users specify a custom config file but it doesn't exist, we throw an Error.
 *
 * @throws If a custom config path is provided but the file does not exist.
 * @throws If no config file is found and the user declines to create one.
 *
 * @param configPath Optional path to the config file. Absolute or relative to cwd.
 * @returns The compiled OpenNext config and the build directory.
 *
 */
export async function compileConfig(configPath: string | undefined) {
	if (configPath && !existsSync(configPath)) {
		throw new Error(`Custom config file not found at ${configPath}`);
	}

	configPath ??= findOpenNextConfig(nextAppDir);

	if (!configPath) {
		const answer = await askConfirmation(
			"Missing required `open-next.config.ts` file, do you want to create one?"
		);

		if (!answer) {
			throw new Error("The `open-next.config.ts` file is required, aborting!");
		}

		configPath = createOpenNextConfigFile(nextAppDir, { cache: false });
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
	const openNextDistDir = path.dirname(require.resolve("@opennextjs/core/debug.js"));

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
