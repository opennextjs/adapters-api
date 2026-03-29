import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { patchCode } from "@opennextjs/aws/build/patch/astCodePatcher.js";

import { getPackageTemplatesDirPath } from "../../utils/get-package-templates-dir-path.js";

export function findOpenNextConfig(appDir: string): string | undefined {
	const openNextConfigPath = join(appDir, "open-next.config.ts");

	if (existsSync(openNextConfigPath)) {
		return openNextConfigPath;
	}

	return undefined;
}

export function createOpenNextConfigFile(appDir: string, options: { cache: boolean }): string {
	const openNextConfigPath = join(appDir, "open-next.config.ts");

	let content = readFileSync(join(getPackageTemplatesDirPath(), "open-next.config.ts"), "utf8");

	if (!options.cache) {
		content = patchCode(content, commentOutR2ImportRule);
		content = patchCode(content, commentOutIncrementalCacheRule);
	}

	writeFileSync(openNextConfigPath, content);

	return openNextConfigPath;
}

const commentOutR2ImportRule = `
rule:
  pattern: import $ID from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
fix: |-
  // import $ID from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
`;

const commentOutIncrementalCacheRule = `
rule:
  pattern: '{ incrementalCache: $ID }'
fix: |-
  {
  	// For best results consider enabling R2 caching
  	// See https://opennext.js.org/cloudflare/caching for more details
  	// incrementalCache: $ID
  }
`;
