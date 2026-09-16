import { defineConfig, devices } from '@playwright/test'

// Two suites share this file:
// - `public`: landing and sign-in surfaces. Needs only the Vite dev server.
// - `release`: the multi-account release demonstration from docs/TESTING.md.
//   Needs the local Supabase stack (API 54321, Mailpit 54324) from docs/SETUP.md.
const port = Number(process.env.PORT) || 5199
const baseURL = process.env.BRIE_BASE_URL || `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'public',
      testMatch: /public-surface\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'release',
      testMatch: /release-demo\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
