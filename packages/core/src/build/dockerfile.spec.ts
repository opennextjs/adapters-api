import { describe, expect, test } from "vitest";

import { getDefaultDockerfile } from "./dockerfile.js";

describe("getDefaultDockerfile", () => {
	test("rebuilds native dependencies in a glibc Linux image", () => {
		const dockerfile = getDefaultDockerfile();

		expect(dockerfile).toContain("FROM node:24-bookworm-slim");
		expect(dockerfile).toContain(
			"npm pkg delete scripts.preinstall scripts.install scripts.postinstall scripts.prepare"
		);
		expect(dockerfile).toContain("npm rebuild --foreground-scripts");
		expect(dockerfile.indexOf("COPY . /app")).toBeLessThan(dockerfile.indexOf("npm rebuild"));
		expect(dockerfile.indexOf("npm pkg delete")).toBeLessThan(dockerfile.indexOf("npm rebuild"));
		expect(dockerfile.indexOf("npm rebuild")).toBeLessThan(
			dockerfile.indexOf("mv /tmp/package.json package.json")
		);
	});
});
