import path from "node:path";

import express from "express";

import { NextConfig } from "@/config/index";
import type { WrapperHandler } from "@/types/overrides.js";
import { getMonorepoRelativePath } from "@/utils/normalize-path";

const wrapper: WrapperHandler = async (handler, converter) => {
	const app = express();
	// We disable this cause we wanna use it ourself
	// https://stackoverflow.com/a/13055495/16587222
	app.disable("x-powered-by");
	// To serve static assets
	const basePath = NextConfig.basePath ?? "";
	app.use(basePath, express.static(path.join(getMonorepoRelativePath(), "assets")));

	const imageHandlerPath = path.join(getMonorepoRelativePath(), "image-optimization-function/index.mjs");

	const imageHandler = await import(imageHandlerPath).then((m) => m.handler);

	app.all(`${NextConfig.basePath ?? ""}/_next/image`, async (req, res) => {
		const internalEvent = await converter.convertFrom(req);
		const output = await converter.convertTo(req, res);
		if (output.type === "direct") {
			await output.data(await imageHandler(internalEvent));
			return;
		}
		const response = await imageHandler(internalEvent, { streamCreator: output.streamCreator });
		const directResult = await output.data?.(response);
		if (directResult === undefined) await output.output;
	});

	app.all(/.*/, async (req, res) => {
		if (req.protocol === "http" && req.hostname === "localhost") {
			// This is used internally by Next.js during redirects in server actions. We need to set it to the origin of the request.
			process.env.__NEXT_PRIVATE_ORIGIN = `${req.protocol}://${req.hostname}`;
			// This is to make `next-auth` and other libraries that rely on this header to work locally out of the box.
			req.headers["x-forwarded-proto"] = req.protocol;
		}
		const internalEvent = await converter.convertFrom(req);
		const output = await converter.convertTo(req, res);
		if (output.type === "direct") {
			await output.data(await handler(internalEvent));
			return;
		}
		await handler(internalEvent, { streamCreator: output.streamCreator });
		await output.output;
	});

	const server = app.listen(Number.parseInt(process.env.PORT ?? "3000", 10), () => {
		console.log(`Server running on port ${process.env.PORT ?? 3000}`);
	});

	app.on("error", (err) => {
		console.error("error", err);
	});

	return () => {
		server.close();
	};
};

export default {
	wrapper,
	name: "expresss-dev",
	supportStreaming: true,
};
