import path from "node:path";

import { debug } from "../logger";

import {
	loadBuildId,
	loadConfig,
	loadFunctionsConfigManifest,
	loadHtmlPages,
	loadMiddlewareManifest,
	loadPrerenderManifest,
	loadRoutingConfig,
} from "./util.js";

export const NEXT_DIR = path.join(__dirname, ".next");
export const OPEN_NEXT_DIR = path.join(__dirname, ".open-next");

debug({ NEXT_DIR, OPEN_NEXT_DIR });

export const NextConfig = /* @__PURE__ */ loadConfig(NEXT_DIR);
export const BuildId = /* @__PURE__ */ loadBuildId(NEXT_DIR);
export const RoutingConfig = /* @__PURE__ */ loadRoutingConfig(NEXT_DIR);
export const HtmlPages = /* @__PURE__ */ loadHtmlPages(NEXT_DIR);
export const PrerenderManifest = /* @__PURE__ */ loadPrerenderManifest(NEXT_DIR);
export const MiddlewareManifest = /* @__PURE__ */ loadMiddlewareManifest(NEXT_DIR);
export const FunctionsConfigManifest = /* @__PURE__ */ loadFunctionsConfigManifest(NEXT_DIR);

process.env.NEXT_BUILD_ID = BuildId;
process.env.NEXT_PREVIEW_MODE_ID = PrerenderManifest?.preview?.previewModeId;
