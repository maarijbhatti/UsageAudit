import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/layout",
  outputDir: "test-results/layout",
  timeout: 30000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3200",
    channel: "chromium",
    screenshot: "only-on-failure",
  },
});
