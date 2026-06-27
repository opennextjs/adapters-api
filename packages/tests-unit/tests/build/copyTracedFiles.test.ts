import { isExcluded, isNonLinuxPlatformPackage } from "@opennextjs/core/build/copyTracedFiles.js";

describe("isExcluded", () => {
	test("should exclude sharp", () => {
		expect(isExcluded("/home/user/git/my-opennext-project/node_modules/sharp/lib/index.js")).toBe(true);
		expect(
			isExcluded(
				"/home/user/git/my-opennext-project/node_modules/.pnpm/sharp/4.1.3/node_modules/sharp/lib/index.js"
			)
		).toBe(true);
		expect(isExcluded("/home/user/git/my-opennext-project/node_modules/sharp")).toBe(true);
	});

	test("should not exclude other packages", () => {
		expect(isExcluded("/home/user/git/my-opennext-project/node_modules/other-package/lib/index.js")).toBe(
			false
		);
		expect(
			isExcluded(
				"/home/user/git/my-opennext-project/node_modules/.pnpm/other-package/4.1.3/node_modules/other-package/lib/index.js"
			)
		).toBe(false);
		expect(
			isExcluded(
				"/home/user/git/my-opennext-project/node_modules/.pnpm/other-package/4.1.3/node_modules/sharp-other-package/lib/index.js"
			)
		).toBe(false);
		expect(
			isExcluded(
				"/home/user/git/my-opennext-project/node_modules/.pnpm/other-package/4.1.3/node_modules/sharp-other"
			)
		).toBe(false);
	});
});

describe("isNonLinuxPlatformPackage", () => {
	test("should identify Darwin (macOS) platform packages", () => {
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/@swc/core-darwin-arm64/swc.darwin-arm64.node"
			)
		).toBe(true);
		expect(isNonLinuxPlatformPackage("/home/user/project/node_modules/@esbuild/darwin-x64/bin/esbuild")).toBe(
			true
		);
		expect(isNonLinuxPlatformPackage("/home/user/project/node_modules/turbo-darwin-arm64/bin/turbo")).toBe(
			true
		);
	});

	test("should identify Windows platform packages", () => {
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/@swc/core-win32-x64-msvc/swc.win32-x64-msvc.node"
			)
		).toBe(true);
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/@rollup/rollup-win32-x64-msvc/rollup.win32-x64-msvc.node"
			)
		).toBe(true);
	});

	test("should identify FreeBSD platform packages", () => {
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/@rollup/rollup-freebsd-x64/rollup.freebsd-x64.node"
			)
		).toBe(true);
	});

	test("should NOT identify Linux platform packages", () => {
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/@swc/core-linux-x64-gnu/swc.linux-x64-gnu.node"
			)
		).toBe(false);
		expect(isNonLinuxPlatformPackage("/home/user/project/node_modules/@esbuild/linux-x64/bin/esbuild")).toBe(
			false
		);
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project_modules/@swc/core-linux-arm64-gnu/swc.linux-arm64-gnu.node"
			)
		).toBe(false);
	});

	test("should NOT identify non-platform packages", () => {
		expect(isNonLinuxPlatformPackage("/home/user/project/node_modules/@swc/core/package.json")).toBe(false);
		expect(isNonLinuxPlatformPackage("/home/user/project/node_modules/next/dist/server/next-server.js")).toBe(
			false
		);
		expect(
			isNonLinuxPlatformPackage("/home/user/project/node_modules/react/cjs/react.production.min.js")
		).toBe(false);
	});

	test("should handle pnpm store paths", () => {
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/.pnpm/@swc+core-darwin-arm64@1.0.0/node_modules/@swc/core-darwin-arm64/swc.darwin-arm64.node"
			)
		).toBe(true);
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/.pnpm/@esbuild+darwin-x64@0.19.0/node_modules/@esbuild/darwin-x64/bin/esbuild"
			)
		).toBe(true);
		expect(
			isNonLinuxPlatformPackage(
				"/home/user/project/node_modules/.pnpm/@swc+core-linux-x64-gnu@1.0.0/node_modules/@swc/core-linux-x64-gnu/swc.linux-x64-gnu.node"
			)
		).toBe(false);
	});
});
