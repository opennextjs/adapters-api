import { expect, test } from "@playwright/test";

/**
 * Tests that the request.url is correct
 */
//TODO: fix this test in a following PR
test.skip("Request.url is host", async ({ baseURL, page }) => {
	await page.goto("/api/host");

	const el = page.getByText(`{"url":"${baseURL}/api/host"}`);
	await expect(el).toBeVisible();
});
