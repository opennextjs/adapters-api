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
		const output = await converter.convertTo(request, { abortSignal: abortSignal ?? request.signal });
		if (output.type === "direct") {
			return output.data(await handler(internalEvent, { waitUntil: ctx.waitUntil.bind(ctx) }));
		}

		const handlerPromise = handler(internalEvent, {
			streamCreator: output.streamCreator,
			waitUntil: ctx.waitUntil.bind(ctx),
		}).catch(async (error: unknown) => {
			await output.streamCreator.abort?.(error);
			throw error;
		});
		if (!output.output) {
			const response = await handlerPromise;
			return output.data?.(response);
		}

		const result = await Promise.race([
			output.output.then((value) => ({ type: "output" as const, value })),
			handlerPromise.then(async (response) => ({
				type: "handler" as const,
				value: await output.data?.(response),
			})),
		]);
		if (result.type === "output") {
			ctx.waitUntil(handlerPromise.then(() => undefined));
			return result.value;
		}
		return result.value !== undefined ? result.value : output.output;
	};

export default {
	wrapper: handler,
	name: "cloudflare-node",
	supportStreaming: true,
} satisfies Wrapper;
