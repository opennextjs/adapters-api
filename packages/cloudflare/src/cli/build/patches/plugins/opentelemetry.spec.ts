import { expect, test } from "vitest";

import { patchOpenTelemetryGlobalUtilsCode } from "./opentelemetry.js";

const code = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unregisterGlobal = exports.getGlobal = exports.registerGlobal = void 0;
const platform_1 = require("../platform");
const version_1 = require("../version");
const semver_1 = require("./semver");
const major = version_1.VERSION.split('.')[0];
const GLOBAL_OPENTELEMETRY_API_KEY = Symbol.for(\`opentelemetry.js.api.\${major}\`);
const _global = platform_1._globalThis;
function registerGlobal(type, instance, diag, allowOverride = false) {
    const api = (_global[GLOBAL_OPENTELEMETRY_API_KEY] = {
        version: version_1.VERSION,
    });
    return semver_1.isCompatible(api.version);
}
`;

test("patches OpenTelemetry to use the Cloudflare global", () => {
	const patched = patchOpenTelemetryGlobalUtilsCode(code);

	expect(patched).toContain('// const platform_1 = require("../platform");');
	expect(patched).toContain("const _global = globalThis;");
	expect(patched).toContain('const version_1 = require("../version");');
	expect(patched).toContain("return semver_1.isCompatible(api.version);");
	expect(patched).not.toContain("platform_1._globalThis");
});

test("captures the platform and global variable names", () => {
	const patched = patchOpenTelemetryGlobalUtilsCode(`
const nodePlatform = require("../platform");
const globalStore = nodePlatform._globalThis;
const unrelatedStore = otherPlatform._globalThis;
`);

	expect(patched).toContain('// const nodePlatform = require("../platform");');
	expect(patched).toContain("const globalStore = globalThis;");
	expect(patched).toContain("const unrelatedStore = otherPlatform._globalThis;");
});
