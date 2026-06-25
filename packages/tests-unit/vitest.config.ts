import path from "node:path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [tsconfigPaths()],
	resolve: {
		alias: {
			"@opennextjs/core": path.resolve(__dirname, "../core/src"),
			"@opennextjs/aws": path.resolve(__dirname, "../open-next/src"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		setupFiles: "./packages/tests-unit/setup.ts",
		coverage: {
			all: true,
			include: ["packages/**"],
			exclude: ["packages/tests-*/**", "**/node_modules/**", "**/dist/**", "**/coverage/**"],
			reporter: ["text", "html", "json", "json-summary"],
			reportOnFailure: true,
		},
		root: "../../",
		include: ["packages/tests-unit/**/*.{test,spec}.?(c|m)ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
	},
});
