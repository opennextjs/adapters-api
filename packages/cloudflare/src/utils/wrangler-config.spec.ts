import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withoutSelfEntrypointServices } from "./wrangler-config.js";

describe("withoutSelfEntrypointServices", () => {
	let directory: string;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "opennext-wrangler-config-"));
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it("keeps the original config when it has no self entrypoint service", () => {
		const configPath = path.join(directory, "wrangler.jsonc");

		const result = withoutSelfEntrypointServices({
			configPath,
			name: "worker-e2e",
			services: [{ binding: "API", service: "api" }],
		});

		expect(result.configPath).toBe(configPath);
		expect(result.isFlattened).toBe(false);
		result.cleanup();
	});

	it("flattens a resolved environment without its self entrypoint service", () => {
		const configPath = path.join(directory, "wrangler.jsonc");

		const result = withoutSelfEntrypointServices({
			configPath,
			name: "worker-e2e",
			services: [
				{ binding: "API", service: "api" },
				{ binding: "NEXT_CACHE_SERVICE", service: "worker-e2e", entrypoint: "OpenNextCache" },
			],
		});

		expect(result.isFlattened).toBe(true);
		expect(JSON.parse(fs.readFileSync(result.configPath!, "utf8"))).toEqual({
			configPath,
			name: "worker-e2e",
			services: [{ binding: "API", service: "api" }],
		});

		result.cleanup();
		expect(fs.existsSync(result.configPath!)).toBe(false);
	});
});
