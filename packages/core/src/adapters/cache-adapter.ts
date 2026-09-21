import { createGenericHandler } from "../core/createGenericHandler.js";

import { handler as cacheHandler } from "./cache-handler.js";

export const handler = await createGenericHandler({
	handler: cacheHandler,
	type: "cache",
});
