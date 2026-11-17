import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(
    `e2e+${label}-${Date.now()}@codequest.app`,
  );
  await page.getByLabel("Display name").fill("E2E Learner");
  await page.getByRole("button", { name: "Enter CodeQuest" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("responsive shell matches the viewport", async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  if ((viewport?.width ?? 0) < 640) {
    await expect(page.locator(".mobile-nav")).toBeVisible();
    await expect(page.locator(".app-sidebar")).toBeHidden();
    await expect(page.locator(".app-rail")).toBeHidden();
  } else if ((viewport?.width ?? 0) < 1024) {
    await expect(page.locator(".mobile-nav")).toBeHidden();
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await expect(page.locator(".rail-toggle")).toBeVisible();
    await expect(page.locator(".app-rail")).toBeHidden();
  } else {
    await expect(page.locator(".mobile-nav")).toBeHidden();
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await expect(page.locator(".rail-toggle")).toBeHidden();
    await expect(page.locator(".app-rail")).toBeVisible();
  }

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("dashboard has no axe violations", async ({ page }, testInfo) => {
  await signIn(page, `axe-${testInfo.project.name}`);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("tablet rail expands and collapses", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "tablet-only rail");
  await signIn(page, "rail");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.locator(".app-frame")).toHaveClass(/rail-open/);
  await expect(
    page.getByRole("button", { name: "Collapse navigation" }),
  ).toBeVisible();
  await expect(page.locator(".side-label").first()).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".app-frame")).not.toHaveClass(/rail-open/);
});

test("keyboard shortcut sheet is reachable and dismissible", async ({
  page,
}, testInfo) => {
  await signIn(page, `keys-${testInfo.project.name}`);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
