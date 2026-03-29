import { compareSemver } from "@opennextjs/aws/build/helper.js";
import logger from "@opennextjs/aws/logger.js";

export async function ensureNextjsVersionSupported({ nextVersion }: { nextVersion: string }) {
	if (compareSemver(nextVersion, "<", "14.2.0")) {
		throw new Error("Next.js version unsupported, please upgrade to version 14.2 or greater.");
	}

	const {
		default: { version: wranglerVersion },
	} = await import("wrangler/package.json", { with: { type: "json" } });

	if (compareSemver(nextVersion, ">=", "16.1.0") && compareSemver(wranglerVersion, "<", "4.59.2")) {
		logger.warn(`Next.js 16.1+ requires wrangler 4.59.2 or greater (${wranglerVersion} detected).`);
	}
}
