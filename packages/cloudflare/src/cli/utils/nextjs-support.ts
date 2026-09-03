import { compareSemver } from "@opennextjs/core/build/helper.js";
import logger from "@opennextjs/core/logger.js";

/**
 * Verifies that Next.js and Wrangler support the adapter contract.
 *
 * @param options The installed Next.js version.
 * @returns A promise that resolves when the versions are supported.
 * @throws When Next.js predates the routing-aware adapter contract.
 */
export async function ensureNextjsVersionSupported({ nextVersion }: { nextVersion: string }): Promise<void> {
	if (compareSemver(nextVersion, "<", "16.2.1")) {
		throw new Error("Next.js version unsupported, please upgrade to version 16.2.1 or greater.");
	}

	const {
		default: { version: wranglerVersion },
	} = await import("wrangler/package.json", { with: { type: "json" } });

	if (compareSemver(nextVersion, ">=", "16.1.0") && compareSemver(wranglerVersion, "<", "4.59.2")) {
		logger.warn(`Next.js 16.1+ requires wrangler 4.59.2 or greater (${wranglerVersion} detected).`);
	}
}
