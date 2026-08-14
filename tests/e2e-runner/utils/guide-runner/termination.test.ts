import { EventEmitter } from 'events';

import {
  arbitrateGuideWork,
  createGuideTerminationController,
  GuideTerminationError,
  raceGuideTermination,
} from './termination';

function createPage() {
  const browser = new EventEmitter();
  const context = new EventEmitter() as EventEmitter & { browser(): EventEmitter };
  context.browser = () => browser;
  const mainFrame = { url: () => 'about:blank' };
  const page = new EventEmitter() as EventEmitter & {
    context(): typeof context;
    mainFrame(): typeof mainFrame;
    url(): string;
  };
  page.context = () => context;
  page.mainFrame = () => mainFrame;
  page.url = () => 'about:blank';
  return { page, context, browser };
}

describe('guide termination controller', () => {
  it('uses the first terminal event and ignores later events', async () => {
    const { page, context, browser } = createPage();
    const controller = createGuideTerminationController(page as never);

    page.emit('crash');
    page.emit('close');
    context.emit('close');
    browser.emit('disconnected');

    await expect(controller.termination).resolves.toMatchObject({
      code: 'BROWSER_CRASHED',
      outcome: 'infrastructure_error',
      classification: 'infrastructure',
    });
    expect(controller.signal.aborted).toBe(true);
    controller.dispose();
  });

  it('does not classify expected teardown as a failure', () => {
    const { page, context, browser } = createPage();
    const controller = createGuideTerminationController(page as never);

    controller.markExpectedTeardown();
    page.emit('close');
    context.emit('close');
    browser.emit('disconnected');

    expect(controller.signal.aborted).toBe(false);
    controller.dispose();
    expect(page.listenerCount('crash')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
    expect(context.listenerCount('close')).toBe(0);
    expect(browser.listenerCount('disconnected')).toBe(0);
    expect(page.listenerCount('framenavigated')).toBe(0);
  });

  it('rejects guide work with the authoritative terminal code', async () => {
    const { page } = createPage();
    const controller = createGuideTerminationController(page as never);
    const work = new Promise<void>(() => undefined);
    const result = raceGuideTermination(work, controller);

    page.emit('close');

    await expect(result).rejects.toMatchObject<Partial<GuideTerminationError>>({
      termination: expect.objectContaining({ code: 'PAGE_CLOSED' }),
    });
    controller.dispose();
  });

  it('caches the last URL before the page terminates', async () => {
    const { page } = createPage();
    const controller = createGuideTerminationController(page as never);
    const frame = page.mainFrame();
    frame.url = () => 'http://localhost:3000/d/example';
    page.emit('framenavigated', frame);

    page.emit('close');
    await controller.termination;

    expect(controller.lastKnownUrl()).toBe('http://localhost:3000/d/example');
    controller.dispose();
  });

  it('waits for cancellation and losing work before terminal publication', async () => {
    const { page } = createPage();
    const controller = createGuideTerminationController(page as never);
    let finishCancel!: () => void;
    let finishWork!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      finishCancel = resolve;
    });
    const work = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const cancel = jest.fn(() => cancellation);

    page.emit('close');
    const arbitration = arbitrateGuideWork(work, controller, cancel, 1000);
    let settled = false;
    void arbitration.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finishCancel();
    await Promise.resolve();
    expect(settled).toBe(false);
    finishWork();

    await expect(arbitration).resolves.toMatchObject({ kind: 'terminated', drained: true });
    controller.dispose();
  });
});
