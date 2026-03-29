import type { NextConfig } from "@opennextjs/aws/types/next-types.js";

interface ExtendedNextConfig extends NextConfig {
	experimental: {
		ppr?: boolean;
		taint?: boolean;
		viewTransition?: boolean;
		serverActions?: boolean;
	};
}

export function needsExperimentalReact(nextConfig: ExtendedNextConfig) {
	const { ppr, taint, viewTransition } = nextConfig.experimental || {};
	return Boolean(ppr || taint || viewTransition);
}
