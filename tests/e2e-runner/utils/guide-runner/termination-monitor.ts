import type { Browser, BrowserContext, Page } from '@playwright/test';

export interface BrowserTermination {
  message: string;
}

export interface BrowserTerminationMonitor {
  termination: Promise<BrowserTermination>;
  expectPageClose(): void;
  dispose(): void;
}

export function createBrowserTerminationMonitor(page: Page): BrowserTerminationMonitor {
  const context: BrowserContext = page.context();
  const browser: Browser | null = context.browser();
  let expectedPageClose = false;
  let terminated = false;
  let resolveTermination!: (termination: BrowserTermination) => void;
  const termination = new Promise<BrowserTermination>((resolve) => {
    resolveTermination = resolve;
  });

  const stop = (message: string) => {
    if (expectedPageClose || terminated) {
      return;
    }
    terminated = true;
    resolveTermination({ message });
  };
  const onCrash = () => stop('The browser page crashed.');
  const onPageClose = () => stop('The browser page closed during step execution.');
  const onContextClose = () => stop('The browser context closed during step execution.');
  const onBrowserDisconnect = () => stop('The browser disconnected during step execution.');

  page.on('crash', onCrash);
  page.on('close', onPageClose);
  context.on('close', onContextClose);
  browser?.on('disconnected', onBrowserDisconnect);

  return {
    termination,
    expectPageClose() {
      expectedPageClose = true;
    },
    dispose() {
      page.off('crash', onCrash);
      page.off('close', onPageClose);
      context.off('close', onContextClose);
      browser?.off('disconnected', onBrowserDisconnect);
    },
  };
}
