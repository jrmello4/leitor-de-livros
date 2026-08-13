import { defineConfig } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/visual',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['json', { outputFile: 'test-results/visual/playwright-report.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:1420',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm.cmd run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !isCi,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_VISUAL_TEST: '1',
      VITE_SMOKE_TEST: '0',
    },
  },
});
