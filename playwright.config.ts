import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, HEADLESS } from './helpers/config';

/**
 * Two projects share one config:
 *  - `api` runs request-only specs (no browser is launched)
 *  - `ui`  runs browser specs against Desktop Chrome
 *
 * The demo is a shared public environment, so the suite runs with a small
 * worker count and one retry on CI to absorb transient network noise.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,

  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,
    // The Toolshop front end exposes stable `data-test` hooks on every interactive element.
    testIdAttribute: 'data-test',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    extraHTTPHeaders: { Accept: 'application/json' },
  },

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'playwright-report.json' }],
  ],

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
