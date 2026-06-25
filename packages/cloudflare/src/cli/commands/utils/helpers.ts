import { type BuildOptions } from "@opennextjs/core/build/helper.js";
import { getPlatformProxy, type GetPlatformProxyOptions } from "wrangler";

import { extractProjectEnvVars } from "../../utils/extract-project-env-vars.js";

export type WorkerEnvVar = Record<keyof CloudflareEnv, string | undefined>;

export async function getEnvFromPlatformProxy(options: GetPlatformProxyOptions, buildOpts: BuildOptions) {
	const envVars = process.env;

	const proxy = await getPlatformProxy<CloudflareEnv>({
		...options,
		envFiles: [],
	});

	Object.entries(proxy.env).forEach(([key, value]) => {
		if (typeof value === "string") {
			envVars[key as keyof CloudflareEnv] = value;
		}
	});

	await proxy.dispose();

	let mode: "production" | "development" | "test" = "production";
	if (envVars.NEXTJS_ENV === "development") {
		mode = "development";
	} else if (envVars.NEXTJS_ENV === "test") {
		mode = "test";
	}

	const dotEnvVars = extractProjectEnvVars(mode, buildOpts);

	for (const varName in dotEnvVars) {
		envVars[varName] ??= dotEnvVars[varName];
	}

	return envVars as unknown as WorkerEnvVar;
}

export function quoteShellMeta(arg: string) {
	if (process.platform === "win32") {
		if (arg.length === 0) {
			return '""';
		}
		const needsEscaping = /[&|<>^()%!"]/;
		const needsQuotes = /\s/.test(arg) || needsEscaping.test(arg);
		let escaped = arg.replace(/"/g, '""');
		if (/[&|<>^()%!]/.test(arg)) {
			escaped = escaped.replace(/[&|<>^()%!]/g, "^$&");
		}
		return needsQuotes ? `"${escaped}"` : escaped;
	}
	if (/["\s]/.test(arg) && !/'/.test(arg)) {
		return `'${arg.replace(/(['\\])/g, "\\$1")}'`;
	}
	if (/["'\s]/.test(arg)) {
		return `"${arg.replace(/(["\\$`!])/g, "\\$1")}"`;
	}
	return arg.replace(/([A-Za-z]:)?([#!"$&'()*,:;<=>?@[\\\]^`{|}])/g, "$1\\$2");
}
