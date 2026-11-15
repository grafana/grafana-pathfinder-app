import { defineConfig, devices } from '@playwright/test';

// Not part of the root Playwright config: the root `testMatch` is `**/*.spec.ts`
// and this harness is `*.pilot.ts`, so `npm run e2e` never starts it.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.pilot.ts',
  timeout: 0,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${process.env.BOMBADIL_PROXY_PORT || '3011'}`,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      args: [
        `--remote-debugging-port=${process.env.BOMBADIL_CDP_PORT || '9333'}`,
        // The fixture CDN is a local HTTPS server standing in for interactive-learning.grafana.net.
        `--host-resolver-rules=MAP interactive-learning.grafana.net 127.0.0.1:${process.env.BOMBADIL_CDN_PORT || '3443'}`,
        '--ignore-certificate-errors',
        // The fixture CDN resolves to loopback; Chromium's local-network checks would block the page's fetch of it.
        '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
      ],
    },
  },
});
