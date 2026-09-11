import type { Locator } from '@playwright/test';

import type { StepSubstepResult } from '../types';
import { captureGuidedEvidence, parseGuidedSubstepResults } from './guided-evidence';

function createRoot() {
  const element = document.createElement('div');
  element.setAttribute('data-test-step-state', 'executing');
  element.setAttribute('data-test-substep-index', '0');
  element.setAttribute('data-test-substep-results', '[]');
  document.body.appendChild(element);
  const handle = {
    evaluate: jest.fn(async (read: (element: Element) => unknown) => read(element)),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  const locator = {
    count: jest.fn(async () => (element.isConnected ? 1 : 0)),
    elementHandle: jest.fn(async () => handle),
  } as unknown as Locator;
  return { element, locator, handle };
}

function result(index: number, status: StepSubstepResult['status'] = 'completed'): StepSubstepResult {
  return { index, action: 'button', status, durationMs: 25 };
}

describe('parseGuidedSubstepResults', () => {
  it('distinguishes a legacy plugin from an empty current run', () => {
    expect(parseGuidedSubstepResults(null)).toBeUndefined();
    expect(parseGuidedSubstepResults('[]')).toEqual([]);
  });

  it('never fills gaps or duplicates a corrected index', () => {
    expect(parseGuidedSubstepResults(JSON.stringify([result(0), result(3, 'skipped'), result(0, 'error')]))).toEqual([
      result(0, 'error'),
      result(3, 'skipped'),
    ]);
  });

  it.each(['completed', 'skipped', 'timeout', 'cancelled', 'error'] as const)(
    'keeps the %s runtime status',
    (status) => {
      expect(parseGuidedSubstepResults(JSON.stringify([result(1, status)]))).toEqual([result(1, status)]);
    }
  );

  it.each([
    'invalid',
    '{}',
    '[null]',
    JSON.stringify([{ ...result(0), index: -1 }]),
    JSON.stringify([{ ...result(0), index: 0.5 }]),
    JSON.stringify([{ ...result(0), action: 'navigate' }]),
    JSON.stringify([{ ...result(0), status: 'passed' }]),
    JSON.stringify([{ ...result(0), durationMs: -1 }]),
    JSON.stringify([{ ...result(0), durationMs: '25' }]),
  ])('rejects malformed evidence %s', (raw) => {
    expect(() => parseGuidedSubstepResults(raw)).toThrow();
  });
});

describe('captured guided evidence', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['30000', 30000],
    ['45000', 45000],
    ['60000', 60000],
    [null, 120000],
    ['', 120000],
    ['0', 120000],
    ['-1', 120000],
    ['NaN', 120000],
    ['Infinity', 120000],
    ['2147483648', 600000],
  ])('uses the effective timeout for %s', async (raw, timeoutMs) => {
    const { element, locator } = createRoot();
    if (raw !== null) {
      element.setAttribute('data-test-step-timeout', raw as string);
    }
    const evidence = await captureGuidedEvidence(locator);
    expect((await evidence.read()).timeoutMs).toBe(timeoutMs);
    await evidence.dispose();
  });

  it('reads consecutive runtime skips from the original detached root', async () => {
    const { element, locator, handle } = createRoot();
    const onSubsteps = jest.fn();
    const evidence = await captureGuidedEvidence(locator, onSubsteps);
    const records = [result(0, 'skipped'), result(1, 'skipped'), result(2)];

    element.setAttribute('data-test-substep-results', JSON.stringify(records));
    element.remove();

    expect(await evidence.read()).toMatchObject({ attached: false, substeps: records });
    expect(onSubsteps).toHaveBeenLastCalledWith(records);
    await evidence.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(locator.elementHandle).toHaveBeenCalledTimes(1);
  });

  it('publishes only new evidence and replaces a callback failure for the same index', async () => {
    const { element, locator } = createRoot();
    const onSubsteps = jest.fn();
    const evidence = await captureGuidedEvidence(locator, onSubsteps);
    element.setAttribute('data-test-substep-results', JSON.stringify([result(0)]));
    await evidence.read();
    await evidence.read();
    element.setAttribute('data-test-substep-results', JSON.stringify([result(0, 'error')]));
    await evidence.read();

    expect(onSubsteps.mock.calls).toEqual([[[result(0)]], [[result(0, 'error')]]]);
    expect(evidence.results()).toEqual([result(0, 'error')]);
    await evidence.dispose();
  });

  it('adds a runner failure cause only after an explicit runtime settlement', async () => {
    const { element, locator } = createRoot();
    const evidence = await captureGuidedEvidence(locator);
    await evidence.read();
    evidence.recordActionFailure(0, 'Target is disabled');
    expect(evidence.results()).toEqual([]);

    element.setAttribute('data-test-substep-results', JSON.stringify([result(0, 'skipped')]));
    await evidence.read();

    expect(evidence.results()).toEqual([{ ...result(0, 'skipped'), error: 'Target is disabled' }]);
    await evidence.dispose();
  });

  it('does not reuse a previous run after reset and retry', async () => {
    const { element, locator } = createRoot();
    const first = await captureGuidedEvidence(locator);
    element.setAttribute('data-test-substep-results', JSON.stringify([result(0, 'error')]));
    await first.read();
    await first.dispose();

    element.setAttribute('data-test-substep-results', '[]');
    const second = await captureGuidedEvidence(locator);
    expect((await second.read()).substeps).toEqual([]);
    await second.dispose();
  });

  it('preserves collected records after a full document replacement', async () => {
    const { element, locator, handle } = createRoot();
    const evidence = await captureGuidedEvidence(locator);
    element.setAttribute('data-test-substep-results', JSON.stringify([result(0)]));
    await evidence.read();
    element.remove();
    handle.evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));

    expect(await evidence.read()).toMatchObject({ attached: false, substeps: [result(0)] });
    await evidence.dispose();
  });

  it('propagates a browser read failure while the root remains attached', async () => {
    const { locator, handle } = createRoot();
    const evidence = await captureGuidedEvidence(locator);
    handle.evaluate.mockRejectedValueOnce(new Error('Browser transport failed'));

    await expect(evidence.read()).rejects.toThrow('Browser transport failed');
    await evidence.dispose();
  });
});
