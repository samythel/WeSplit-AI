import { test, expect } from "@playwright/test";

test("app root responds", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/http:\/\/localhost:8081\//);
});
