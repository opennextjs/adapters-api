import { expect, test } from "playwright/test";

//TODO: fix this test, this is the resolution of the 500 route that is not working as expected
test.skip("should return 500 on middleware error", async ({ request }) => {
  const response = await request.get("/", {
    headers: {
      "x-throw": "true",
    },
  });
  const body = await response.text();
  expect(response.status()).toBe(500);
  expect(body).toContain("Internal Server Error");
});
