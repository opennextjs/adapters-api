import fs from "node:fs";
import path from "node:path";

import type { PublicFiles, RuntimeRoutingConfig } from "@/types/adapter";
import type {
	FunctionsConfigManifest,
	MiddlewareManifest,
	NextConfig,
	PrerenderManifest,
} from "@/types/next-types";

export function loadConfig(nextDir: string) {
	const filePath = path.join(nextDir, "required-server-files.json");
	const json = fs.readFileSync(filePath, "utf-8");
	const { config } = JSON.parse(json);
	return config as NextConfig;
}

export function loadBuildId(nextDir: string) {
	return fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf-8").trim();
}

export function loadRoutingConfig(nextDir: string): RuntimeRoutingConfig {
	const json = fs.readFileSync(path.join(nextDir, "open-next-routing.json"), "utf-8");
	return JSON.parse(json) as RuntimeRoutingConfig;
}

export function loadPagesManifest(nextDir: string) {
	const json = fs.readFileSync(path.join(nextDir, "server/pages-manifest.json"), "utf-8");
	return JSON.parse(json) as Record<string, string>;
}

export function loadHtmlPages(nextDir: string) {
	return Object.entries(loadPagesManifest(nextDir))
		.filter(([, value]) => value.endsWith(".html"))
		.map(([pathname]) => pathname);
}

export function loadAppPathsManifest(nextDir: string) {
	const filePath = path.join(nextDir, "server/app-paths-manifest.json");
	return JSON.parse(fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "{}") as Record<
		string,
		string
	>;
}

export function loadPublicAssets(openNextDir: string) {
	const json = fs.readFileSync(path.join(openNextDir, "public-files.json"), "utf-8");
	return JSON.parse(json) as PublicFiles;
}

export function loadPrerenderManifest(nextDir: string): PrerenderManifest | undefined {
	const filePath = path.join(nextDir, "prerender-manifest.json");
	if (!fs.existsSync(filePath)) {
		return undefined;
	}
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function loadMiddlewareManifest(nextDir: string) {
	const json = fs.readFileSync(path.join(nextDir, "server/middleware-manifest.json"), "utf-8");
	return JSON.parse(json) as MiddlewareManifest;
}

export function loadFunctionsConfigManifest(nextDir: string) {
	try {
		const json = fs.readFileSync(path.join(nextDir, "server/functions-config-manifest.json"), "utf-8");
		return JSON.parse(json) as FunctionsConfigManifest;
	} catch {
		return { functions: {}, version: 1 };
	}
}
