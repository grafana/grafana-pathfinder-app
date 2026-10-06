import { defineConfig } from '@playwright/test';
import type { PluginOptions } from '@grafana/plugin-e2e';
import { readFileSync } from 'node:fs';

if (!process.env.CODA_HARNESS_STATE) {
  throw new Error('Run npm run test:coda with CODA_HARNESS_ROOT set to the Coda app checkout');
}

export default defineConfig<PluginOptions>({
  testDir: './tests/coda',
  timeout: 120000,
  expect: { timeout: 25000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./tests/coda/.harness/reporter.ts']],
  outputDir: 'test-results/coda',
  use: {
    baseURL: `http://127.0.0.1:${process.env.CODA_GRAFANA_PORT ?? '13012'}`,
    user: { user: 'admin', password: readFileSync(`${process.env.CODA_HARNESS_STATE}/admin-password`, 'utf8') },
    viewport: { width: 1600, height: 1000 },
    trace: 'off',
    screenshot: 'off',
  },
});
