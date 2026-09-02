import {
	selectCompressionEncoding,
	withCompressionVary,
} from "@opennextjs/aws/overrides/wrappers/compression.js";
import { describe, expect, it } from "vitest";

describe("compression helpers", () => {
	it("respects quality values and disabled encodings", () => {
		expect(selectCompressionEncoding("gzip;q=0, deflate;q=0.5, br;q=0.8")).toBe("br");
		expect(selectCompressionEncoding("gzip;q=0")).toBeNull();
		expect(selectCompressionEncoding("*;q=0.5")).toBe("br");
	});

	it("adds Accept-Encoding to Vary once", () => {
		expect(withCompressionVary({ vary: "RSC" })).toEqual({ vary: "RSC, Accept-Encoding" });
		expect(withCompressionVary({ vary: "RSC, accept-encoding" })).toEqual({
			vary: "RSC, accept-encoding",
		});
	});
});
