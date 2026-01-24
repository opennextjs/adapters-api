import { expect, test } from "@playwright/test";

// https://github.com/opennextjs/opennextjs-cloudflare/issues/942
//TODO: Fail if it's the first one to run with: AsyncLocalStorage accessed in runtime where it is not available
test.skip("Dynamic catch-all API route with hyphen param", async ({ request }) => {
  const res = await request.get("/api/auth/opennext/is/really/cool");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/json");
  const json = await res.json();
  expect(json).toStrictEqual({ slugs: ["opennext", "is", "really", "cool"] });
});
