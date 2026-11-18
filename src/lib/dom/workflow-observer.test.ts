import { observeWorkflowStateChanges } from './workflow-observer';

function marker() {
  const element = document.createElement('div');
  element.dataset.testid = 'generate-token-success-message';
  return element;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  jest.useRealTimers();
});

it('rechecks marker insertion and removal within 50 ms, without reading its contents', async () => {
  const changed = jest.fn();
  const stop = observeWorkflowStateChanges(changed);
  try {
    const success = marker();
    for (const property of ['textContent', 'innerHTML']) {
      Object.defineProperty(success, property, {
        get: () => {
          throw new Error('Do not read secrets');
        },
      });
    }
    document.body.append(success);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(49);
    expect(changed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(changed).toHaveBeenCalledTimes(1);
    success.remove();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it('ignores unrelated DOM updates, text updates, and guide-owned markers', async () => {
  const changed = jest.fn();
  const guide = document.createElement('div');
  guide.dataset.pathfinderContent = 'true';
  document.body.append(guide);
  const stop = observeWorkflowStateChanges(changed);
  try {
    const other = document.createElement('div');
    document.body.append(other);
    other.textContent = 'Unrelated state';
    guide.append(marker());
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
    guide.replaceChildren();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('coalesces replaced forms and cancels pending notifications on cleanup', async () => {
  const changed = jest.fn();
  const stop = observeWorkflowStateChanges(changed);
  const form = document.createElement('form');
  form.append(marker());
  document.body.append(form);
  await Promise.resolve();
  form.replaceChildren(marker());
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(50);
  expect(changed).toHaveBeenCalledTimes(1);
  form.remove();
  await Promise.resolve();
  stop();
  document.body.append(marker());
  await jest.advanceTimersByTimeAsync(1000);
  expect(changed).toHaveBeenCalledTimes(1);
});
