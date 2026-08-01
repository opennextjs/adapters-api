import { expect, test } from "@playwright/test";

test("serves SSR from the Node.js container", async ({ page }) => {
	await page.goto("/ssr");

	await expect(page.getByText("Time:")).toBeVisible();
});

test("runs external middleware before forwarding to the container", async ({ page }) => {
	await page.goto("/rewrite");

	await expect(page).toHaveURL(/\/rewrite$/);
	await expect(page.getByText("Rewritten Destination", { exact: true })).toBeVisible();
});
