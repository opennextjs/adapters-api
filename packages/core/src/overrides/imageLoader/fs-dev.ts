import fs from "node:fs";
import path from "node:path";

import { NextConfig } from "@/config/index";
import type { ImageLoader } from "@/types/overrides";
import { getMonorepoRelativePath } from "@/utils/normalize-path";

export default {
	name: "fs-dev",
	load: async (url: string) => {
		const urlWithoutBasePath = NextConfig.basePath ? url.slice(NextConfig.basePath.length) : url;
		const imagePath = path.join(getMonorepoRelativePath(), "assets", urlWithoutBasePath);
		// A stream emits this as an `error` event nothing listens to, which would kill the server.
		const stats = await fs.promises.stat(imagePath);
		if (!stats.isFile()) {
			throw new Error(`The image is not a file: ${imagePath}`);
		}
		const body = fs.createReadStream(imagePath);
		const contentType = url.endsWith(".png") ? "image/png" : "image/jpeg";
		return {
			body,
			contentType,
			cacheControl: "public, max-age=31536000, immutable",
		};
	},
} satisfies ImageLoader;
