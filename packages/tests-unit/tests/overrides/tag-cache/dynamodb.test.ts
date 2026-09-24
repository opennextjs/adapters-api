import { hasHardRevalidation } from "../../../../aws/src/overrides/tagCache/dynamodb.js";
import { describe, expect, it } from "vitest";

describe("DynamoDB tag cache", () => {
	it("does not hard-invalidate a tag before its SWR expiry", () => {
		const result = hasHardRevalidation(
			[{ revalidatedAt: { N: "1500" }, stale: { N: "1500" }, expire: { N: "3000" } }],
			1_000,
			2_000
		);

		expect(result).toBe(false);
	});

	it("hard-invalidates a tag after its SWR expiry", () => {
		const result = hasHardRevalidation(
			[{ revalidatedAt: { N: "1500" }, stale: { N: "1500" }, expire: { N: "1800" } }],
			1_000,
			2_000
		);

		expect(result).toBe(true);
	});

	it("keeps a tag stale when its SWR window has no expiry", () => {
		const result = hasHardRevalidation(
			[{ revalidatedAt: { N: "1500" }, stale: { N: "1500" } }],
			1_000,
			2_000
		);

		expect(result).toBe(false);
	});
});
