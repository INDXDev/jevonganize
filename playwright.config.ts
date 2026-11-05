import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'web', testMatch: '*.web.test.ts' },
    { name: 'electron', testMatch: '*.electron.test.ts' },
  ],
});
