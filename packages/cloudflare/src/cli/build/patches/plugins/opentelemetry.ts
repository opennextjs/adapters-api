import { patchCode } from "@opennextjs/core/build/patch/astCodePatcher.js";
import type { CodePatcher } from "@opennextjs/core/build/patch/codePatcher.js";
import { getCrossPlatformPathRegex } from "@opennextjs/core/utils/regex.js";

export const commentPlatformImportRule = `
rule:
  pattern: const $PLATFORM = require("../platform");
fix: // const $PLATFORM = require("../platform");
`;

export const replaceGlobalRule = `
rule:
  all:
    - pattern: const $GLOBAL = $PLATFORM._globalThis;
    - inside:
        kind: program
        stopBy: end
        has:
          pattern: const $PLATFORM = require("../platform");
fix: const $GLOBAL = globalThis;
`;

export function patchOpenTelemetryGlobalUtilsCode(code: string): string {
	let patchedCode = patchCode(code, replaceGlobalRule);
	patchedCode = patchCode(patchedCode, commentPlatformImportRule);
	return patchedCode;
}

export const patchOpenTelemetryGlobalUtils: CodePatcher = {
	name: "patch-opentelemetry-global-utils",
	patches: [
		{
			pathFilter: getCrossPlatformPathRegex(
				String.raw`@opentelemetry/api/build/src/internal/global-utils\.js$`,
				{ escape: false }
			),
			contentFilter: /require\(["']\.\.\/platform["']\)/,
			patchCode: async ({ code }) => patchOpenTelemetryGlobalUtilsCode(code),
		},
	],
};
