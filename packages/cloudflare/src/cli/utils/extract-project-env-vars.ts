import * as fs from "node:fs";
import * as path from "node:path";

import { parse } from "@dotenvx/dotenvx";
import type { BuildOptions } from "@opennextjs/aws/build/helper.js";

function readEnvFile(filePath: string) {
	if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
		return parse(fs.readFileSync(filePath, "utf-8"));
	}
}

export function extractProjectEnvVars(mode: string, { monorepoRoot, appPath }: BuildOptions) {
	return [".env", `.env.${mode}`, ...(mode !== "test" ? [".env.local"] : []), `.env.${mode}.local`]
		.flatMap((fileName) => [
			...(monorepoRoot !== appPath ? [readEnvFile(path.join(monorepoRoot, fileName))] : []),
			readEnvFile(path.join(appPath, fileName)),
		])
		.reduce<Record<string, string>>((acc, overrides) => ({ ...acc, ...overrides }), {});
}
