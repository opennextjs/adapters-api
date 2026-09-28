import { getCrossPlatformPathRegex } from "@/utils/regex.js";

import { createPatchCode } from "../astCodePatcher.js";
import type { CodePatcher } from "../codePatcher.js";

// Next derives staleness from time and does not consume custom cache-handler metadata.
// Preserve blocking invalidation (-1), and add our tag signal to both fetch and route results.
export const rule = `
rule:
  kind: shorthand_property_identifier
  regex: ^isStale$
  inside:
    kind: method_definition
    stopBy: end
    has:
      kind: property_identifier
      regex: ^get$
fix:
  'isStale: isStale === -1 ? -1 : cacheData?.isStale || isStale'
`;

export const patchTagStaleness = {
	name: "patchTagStaleness",
	patches: [
		{
			versions: ">=14.1.0",
			pathFilter: getCrossPlatformPathRegex("server/lib/incremental-cache/index.js"),
			patchCode: createPatchCode(rule),
		},
	],
} satisfies CodePatcher;
