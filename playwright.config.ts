import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:43123",
    viewport: { width: 1280, height: 800 },
    locale: "ja-JP",
    acceptDownloads: true,
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:43123",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", grepInvert: /@webkit/, use: { ...devices["Desktop Chrome"] } },
    // The macOS app runs WebKit; tests tagged @webkit cover what only it does differently.
    { name: "webkit", grep: /@webkit/, use: { ...devices["Desktop Safari"] } },
  ],
});
