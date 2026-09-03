import type { InternalEvent } from "@/types/open-next";
import type { OpenNextHandlerOptions, Wrapper, WrapperHandler } from "@/types/overrides";

const dummyWrapper: WrapperHandler =
	async (handler, converter) =>
	async (...args: unknown[]): Promise<unknown> => {
		const [event, options] = args as [InternalEvent, OpenNextHandlerOptions | undefined];
		const output = await converter.convertTo(event, options);
		if (output.type === "direct") {
			return output.data(await handler(event, options));
		}
		const response = await handler(event, { ...options, streamCreator: output.streamCreator });
		const directResult = await output.data?.(response);
		return directResult !== undefined ? directResult : output.output;
	};

export default {
	name: "dummy",
	wrapper: dummyWrapper,
	supportStreaming: true,
} satisfies Wrapper;
