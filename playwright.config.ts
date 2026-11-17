import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "DATABASE_PATH=.data/e2e.db DEVELOPER_EMAILS=e2e@codequest.app NEXT_PUBLIC_APP_VERSION=0.4.0 MIN_SUPPORTED_VERSION=0.1.0 ./node_modules/.bin/next dev -H 127.0.0.1 -p 3100",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        browserName: "chromium",
      },
    },
    {
      name: "tablet",
      use: {
        viewport: { width: 834, height: 1112 },
        hasTouch: true,
        browserName: "chromium",
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 900 },
        browserName: "chromium",
      },
    },
  ],
});
