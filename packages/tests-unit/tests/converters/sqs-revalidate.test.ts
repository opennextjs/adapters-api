import converter from "@opennextjs/aws/overrides/converters/sqs-revalidate.js";
import { describe, expect, it } from "vitest";

describe("sqs-revalidate converter", () => {
	it("returns a direct finalizer for failed records", async () => {
		const output = await converter.convertTo({});
		expect(output.type).toBe("direct");
		if (output.type !== "direct") {
			throw new Error("Expected a direct converter output");
		}

		await expect(
			output.data({
				type: "revalidate",
				records: [
					{ host: "example.com", url: "/first", id: "one" },
					{ host: "example.com", url: "/second", id: "two" },
				],
			})
		).resolves.toEqual({
			type: "revalidate",
			batchItemFailures: [{ itemIdentifier: "one" }, { itemIdentifier: "two" }],
		});
	});
});
