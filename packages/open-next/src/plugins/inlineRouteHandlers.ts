import { getCrossPlatformPathRegex } from "utils/regex.js";
import type { NextAdapterOutputs } from "../adapter.js";
import { patchCode } from "../build/patch/astCodePatcher.js";
import type { ContentUpdater, Plugin } from "./content-updater.js";

export function inlineRouteHandler(
  updater: ContentUpdater,
  outputs: NextAdapterOutputs,
  packagePath: string,
): Plugin {
  console.log("## inlineRouteHandler");
  return updater.updateContent("inlineRouteHandler", [
    // This one will inline the route handlers into the adapterHandler's getHandler function.
    {
      filter: getCrossPlatformPathRegex(
        String.raw`core/routing/adapterHandler\.js$`,
        {
          escape: false,
        },
      ),
      contentFilter: /getHandler/,
      callback: ({ contents }) => patchCode(contents, inlineRule(outputs)),
    },
    // For turbopack, we need to also patch the `[turbopack]_runtime.js` file.
    {
      filter: getCrossPlatformPathRegex(
        String.raw`\[turbopack\]_runtime\.js$`,
        {
          escape: false,
        },
      ),
      contentFilter: /loadRuntimeChunkPath/,
      callback: ({ contents }) => {
        const result = patchCode(contents, inlineChunksRule);
        //TODO: Maybe find another way to do that.
        return `${result}\n${inlineChunksFn(outputs, packagePath)}`;
      },
    },
  ]);
}

function inlineRule(outputs: NextAdapterOutputs) {
  const routeToHandlerPath: Record<string, string> = {};

  for (const type of ["pages", "pagesApi", "appPages", "appRoutes"] as const) {
    for (const { pathname, filePath } of outputs[type]) {
      routeToHandlerPath[pathname] = filePath;
    }
  }

  return `
rule:
  pattern: "function getHandler($ROUTE) { $$$BODY }"
fix: |-
  function getHandler($ROUTE) {
    switch($ROUTE.route) {
${Object.entries(routeToHandlerPath)
  .map(([route, file]) => `      case "${route}": return require("${file}");`)
  .join("\n")}
      default:
        throw new Error(\`Not found \${$ROUTE.route}\`);
    }

  }`;
}

//TODO: Make this one more resilient to code changes
const inlineChunksRule = `
rule:
  kind: call_expression
  pattern: require(resolved)
fix:
  requireChunk(chunkPath)
`;

function getInlinableChunks(outputs: NextAdapterOutputs, packagePath: string, prefix?: string) {
  const chunks = new Set<string>();
  // TODO: handle middleware
  for (const type of ["pages", "pagesApi", "appPages", "appRoutes"] as const) {
    for (const { assets } of outputs[type]) {
      for (let asset of Object.keys(assets)) {
        if (
          asset.includes(".next/server/chunks/") &&
          !asset.includes("[turbopack]_runtime.js")
        ) {
          asset = packagePath !== "" ? asset.replace(`${packagePath}/`, "") : asset;
          chunks.add(prefix ? `${prefix}${asset}` : asset);
        }
      }
    }
  }
  return chunks;
}

function inlineChunksFn(outputs: NextAdapterOutputs, packagePath: string) {
  // From the outputs, we extract every chunks
  const chunks = getInlinableChunks(outputs, packagePath);
  return `
  function requireChunk(chunk) {
    const chunkPath = ".next/" + chunk;
    switch(chunkPath) {
${Array.from(chunks)
  .map((chunk) => `      case "${chunk}": return require("./${chunk}");`)
  .join("\n")}
      default:
        throw new Error(\`Not found \${chunkPath}\`);
    }
  }
`;
}

/**
 *  Esbuild plugin to mark all chunks that we inline as external.
 */
export function externalChunksPlugin(outputs: NextAdapterOutputs, packagePath: string): Plugin {
  const chunks = getInlinableChunks(outputs, packagePath, `./`);
  return {
    name: "external-chunks",
    setup(build) {
      build.onResolve({ filter: /\/chunks\// }, (args) => {
        if (chunks.has(args.path)) {
          return {
            path: args.path,
            external: true,
          };
        }
      });
    },
  };
}
