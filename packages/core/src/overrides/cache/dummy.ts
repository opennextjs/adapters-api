import type { Cache } from "@/types/overrides";
import { IgnorableError } from "@/utils/error";

const dummyCache: Cache = {
	name: "dummy",
	get: async () => {
		throw new IgnorableError('"Dummy" cache does not cache anything');
	},
	set: async () => {
		throw new IgnorableError('"Dummy" cache does not cache anything');
	},
	delete: async () => {
		throw new IgnorableError('"Dummy" cache does not cache anything');
	},
};

export default dummyCache;
