import { EventEmitter } from 'events';

import { createBrowserTerminationMonitor } from './termination-monitor';

function createPage() {
  const browser = new EventEmitter();
  const context = new EventEmitter() as EventEmitter & { browser(): EventEmitter };
  context.browser = () => browser;
  const page = new EventEmitter() as EventEmitter & { context(): typeof context };
  page.context = () => context;
  return { page, context, browser };
}

describe('browser termination monitor', () => {
  it('uses the first unexpected browser event', async () => {
    const { page, context, browser } = createPage();
    const monitor = createBrowserTerminationMonitor(page as never);

    page.emit('crash');
    page.emit('close');
    context.emit('close');
    browser.emit('disconnected');

    await expect(monitor.termination).resolves.toEqual({ message: 'The browser page crashed.' });
    monitor.dispose();
  });

  it('ignores a page close requested by the step deadline', async () => {
    const { page, context, browser } = createPage();
    const monitor = createBrowserTerminationMonitor(page as never);
    let resolved = false;
    void monitor.termination.then(() => {
      resolved = true;
    });

    monitor.expectPageClose();
    page.emit('close');
    context.emit('close');
    browser.emit('disconnected');
    await Promise.resolve();
    expect(resolved).toBe(false);

    expect(page.listenerCount('close')).toBe(1);
    monitor.dispose();
    expect(page.listenerCount('crash')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
    expect(context.listenerCount('close')).toBe(0);
    expect(browser.listenerCount('disconnected')).toBe(0);
  });

  it.each([
    ['close', 'The browser page closed during step execution.'],
    ['context', 'The browser context closed during step execution.'],
    ['browser', 'The browser disconnected during step execution.'],
  ])('reports an unexpected %s event', async (source, message) => {
    const { page, context, browser } = createPage();
    const monitor = createBrowserTerminationMonitor(page as never);

    if (source === 'close') {
      page.emit('close');
    } else if (source === 'context') {
      context.emit('close');
    } else {
      browser.emit('disconnected');
    }

    await expect(monitor.termination).resolves.toEqual({ message });
    monitor.dispose();
  });
});
