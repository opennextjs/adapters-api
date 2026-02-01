import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	serverExternalPackages: ["@prisma/client", ".prisma/client"],
	typescript: {
		ignoreBuildErrors: true,
	},
};

initOpenNextCloudflareForDev();

export default nextConfig;
