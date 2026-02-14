import { expect, test } from "@playwright/test";

/**
 * Tests that the request.url is correct
 */
//TODO: fix this test in a following PR, returns http://n/api/host instead of http://localhost:8787/api/host
test.skip("Request.url is host", async ({ baseURL, page }) => {
	await page.goto("/api/host");

	const el = page.getByText(`{"url":"${baseURL}/api/host"}`);
	await expect(el).toBeVisible();
});
