import type { InternalEvent, InternalResult } from "@/types/open-next";
import type { Wrapper, WrapperHandler } from "@/types/overrides";

const handler: WrapperHandler<InternalEvent, InternalResult> =
	async (handler, converter) =>
	async (...args: unknown[]): Promise<unknown> => {
		const [request, env, ctx, abortSignal] = args as [
			Request,
			Record<string, string>,
			{ waitUntil: (promise: Promise<unknown>) => void },
			AbortSignal,
		];
		globalThis.process = process;
		// Set the environment variables
		// Cloudflare suggests to not override the process.env object but instead apply the values to it
		for (const [key, value] of Object.entries(env)) {
			if (typeof value === "string") {
				process.env[key] = value;
			}
		}

		const internalEvent = await converter.convertFrom(request);
		const output = await converter.convertTo(request, { abortSignal });
		if (output.type === "direct") {
			return output.data(await handler(internalEvent));
		}

		ctx.waitUntil(
			handler(internalEvent, {
				streamCreator: output.streamCreator,
				waitUntil: ctx.waitUntil.bind(ctx),
			})
		);

		return output.output;
	};

export default {
	wrapper: handler,
	name: "cloudflare-node",
	supportStreaming: true,
} satisfies Wrapper;
