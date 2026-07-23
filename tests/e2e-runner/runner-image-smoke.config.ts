import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: 'runner-image-smoke.spec.ts',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
      },
    },
  ],
});
