import { finished } from "node:stream/promises";

import type { OpenNextNodeResponse } from "@/http/index";
import type { IncomingMessage } from "@/http/request";
import type { ResolvedRoute, RoutingResult, WaitUntil } from "@/types/open-next";

/**
 * This function loads the necessary routes, and invoke the expected handler.
 * @param routingResult The result of the routing process, containing information about the matched route and any parameters.
 */
export async function adapterHandler(
	req: IncomingMessage,
	res: OpenNextNodeResponse,
	routingResult: RoutingResult,
	options: {
		waitUntil?: WaitUntil;
	} = {}
) {
	let resolved = false;

	const pendingPromiseRunner = globalThis.__openNextAls.getStore()?.pendingPromiseRunner;
	const waitUntil = options.waitUntil ?? pendingPromiseRunner?.add.bind(pendingPromiseRunner);

	// Our internal routing could return /500 or /404 routes, we first check that
	if (routingResult.internalEvent.rawPath === "/404") {
		await handle404(req, res, waitUntil);
		return;
	}
	if (routingResult.internalEvent.rawPath === "/500") {
		await handle500(req, res, waitUntil);
		return;
	}

	//TODO: replace this at runtime with a version precompiled for the cloudflare adapter.
	for (const route of routingResult.resolvedRoutes) {
		const module = getHandler(route);
		if (!module || resolved) {
			return;
		}

		try {
			console.log("## adapterHandler trying route", route, req.url);
			const result = await module.handler(req, res, {
				waitUntil,
			});
			console.log("## adapterHandler route succeeded", route);
			resolved = true;
			return result;
			//If it doesn't throw, we are done
		} catch (e) {
			console.log("## adapterHandler route failed", route, e);
			// I'll have to run some more tests, but in theory, we should not have anything special to do here, and we should return the 500 page here.
			await handle500(req, res, waitUntil);
			return;
		}
	}
	if (!resolved) {
		console.log("## adapterHandler no route resolved for", req.url);
		await handle404(req, res, waitUntil);
		return;
	}
}

async function handle404(req: IncomingMessage, res: OpenNextNodeResponse, waitUntil?: WaitUntil) {
	try {
		// TODO: find the correct one to use.
		const module = getHandler({
			route: "/_not-found",
			type: "app",
			isFallback: false,
		});
		if (module) {
			await module.handler(req, res, {
				waitUntil,
			});
			return;
		}
	} catch (e2) {
		console.log("## adapterHandler not found route also failed", e2);
	}
	// Ideally we should never reach here as the 404 page should be the Next.js one.
	res.statusCode = 404;
	res.end("Not Found");
	await finished(res);
}

async function handle500(req: IncomingMessage, res: OpenNextNodeResponse, waitUntil?: WaitUntil) {
	try {
		// TODO: find the correct one to use.
		const module = getHandler({
			route: "/_global-error",
			type: "app",
			isFallback: false,
		});
		if (module) {
			await module.handler(req, res, {
				waitUntil,
			});
			return;
		}
	} catch (e2) {
		console.log("## adapterHandler global error route also failed", e2);
	}
	res.statusCode = 500;
	res.end("Internal Server Error");
	await finished(res);
}

// Body replaced at build time
function getHandler(route: ResolvedRoute):
	| undefined
	| {
			handler: (
				req: IncomingMessage,
				res: OpenNextNodeResponse,
				options: { waitUntil?: (promise: Promise<void>) => void }
			) => Promise<void>;
	  } {
	return undefined;
}
