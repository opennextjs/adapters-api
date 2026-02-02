import type { InternalEvent } from "@/types/open-next";
import type { OpenNextHandlerOptions, Wrapper, WrapperHandler } from "@/types/overrides";

const dummyWrapper: WrapperHandler = async (handler, _converter) => {
	return async (...args: unknown[]): Promise<unknown> => {
		const [event, options] = args as [InternalEvent, OpenNextHandlerOptions | undefined];
		return await handler(event, options);
	};
};

export default {
	name: "dummy",
	wrapper: dummyWrapper,
	supportStreaming: true,
} satisfies Wrapper;
