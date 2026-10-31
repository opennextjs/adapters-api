import { ENV } from "./env.js";
import { cleanup, deploy, logs } from "./hooks.js";
import { getTarget } from "./targets.js";

const appDir = process.cwd();

async function main(hook: string | undefined): Promise<void> {
	switch (hook) {
		case "deploy":
			await deploy({
				appDir,
				env: process.env,
				target: getTarget(process.env[ENV.TARGET]),
				stdout: (line) => console.log(line),
				stderr: (line) => console.error(line),
			});
			break;
		case "logs":
			console.log(logs(appDir));
			break;
		case "cleanup":
			await cleanup(appDir);
			break;
		default:
			throw new Error(`Unknown hook "${hook}"`);
	}
}

try {
	await main(process.argv[2]);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
