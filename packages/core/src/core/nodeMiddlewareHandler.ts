import type { RequestData } from "@/types/global";

type EdgeRequest = Omit<RequestData, "page">;

declare const __OPEN_NEXT_NODE_MIDDLEWARE_PATH__: string;

// Do we need Buffer here?
// oxlint-disable-next-line import/first
import { Buffer } from "node:buffer";
globalThis.Buffer = Buffer;

// AsyncLocalStorage is needed to be defined globally
// oxlint-disable-next-line import/first
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage = AsyncLocalStorage;

interface NodeMiddleware {
	default: (req: { handler: unknown; request: EdgeRequest; page: "middleware" }) => Promise<{
		response: Response;
		waitUntil: Promise<void>;
	}>;
	middleware: unknown;
}

let _module: NodeMiddleware | undefined;

export default async function middlewareHandler(request: EdgeRequest): Promise<Response> {
	if (!_module) {
		// We use await import here so that we are sure that it is loaded after AsyncLocalStorage is defined on globalThis
		// We need both await here, same way as in https://github.com/opennextjs/opennextjs-aws/pull/704
		// This identifier is replaced with a string literal by the middleware build.
		_module = await (await import(__OPEN_NEXT_NODE_MIDDLEWARE_PATH__)).default;
	}
	const adapterFn = _module!.default || _module;
	const result = await adapterFn({
		handler: _module!.middleware || _module,
		request: request,
		page: "middleware",
	});
	globalThis.__openNextAls.getStore()?.pendingPromiseRunner.add(result.waitUntil);
	return result.response;
}
