import { expect, test } from "@playwright/test";

test.describe("PPR", () => {
	test("PPR should show loading first", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("link", { name: "Incremental PPR" }).click();
		await page.waitForURL("/ppr");
		const loading = page.getByText("Loading...");
		await expect(loading).toBeVisible();
		const el = page.getByText("Dynamic Component");
		await expect(el).toBeVisible();
	});

	test("PPR rsc prefetch request should be cached", async ({ request }) => {
		const resp = await request.get("/ppr", {
			headers: { rsc: "1", "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" },
		});
		expect(resp.status()).toEqual(200);
		const headers = resp.headers();
		expect(headers["x-nextjs-postponed"]).toEqual("2");
		expect(headers["x-nextjs-prerender"]).toEqual("1");
		expect(headers["x-opennext-cache"]).toEqual("HIT");
		expect(headers["cache-control"]).toEqual("s-maxage=31536000, stale-while-revalidate=2592000");
	});
});
