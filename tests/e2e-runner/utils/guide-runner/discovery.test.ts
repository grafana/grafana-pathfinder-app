jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import type { Locator, Page } from '@playwright/test';

import { CURRENT_STEP_SELECTOR, LEGACY_STEP_SELECTOR } from './constants';
import { discoverStepsFromDOM, withExecutedCoverage } from './discovery';

function root(attributes: Record<string, string | null>): Locator {
  return {
    getAttribute: jest.fn((name: string) => Promise.resolve(attributes[name] ?? null)),
    scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
  } as unknown as Locator;
}

function pageWithRoots(current: Locator[], legacy: Locator[] = []): Page {
  const control = (count: number) => ({
    count: jest.fn().mockResolvedValue(count),
    isVisible: jest.fn().mockResolvedValue(false),
    getAttribute: jest.fn().mockResolvedValue('idle'),
  });
  return {
    locator: jest.fn((selector: string) => ({
      all: jest.fn().mockResolvedValue(selector === CURRENT_STEP_SELECTOR ? current : legacy),
    })),
    getByTestId: jest.fn((testId: string) => {
      if (testId.startsWith('interactive-step-completed-')) {
        return control(1);
      }
      if (testId.startsWith('interactive-do-it-')) {
        return control(1);
      }
      return control(0);
    }),
  } as unknown as Page;
}

describe('discoverStepsFromDOM', () => {
  it('uses the current tracked-root contract and reports unsupported roots', async () => {
    const page = pageWithRoots([
      root({
        'data-test-step-kind': 'plain',
        'data-test-step-id': 'plain-1',
        'data-targetaction': 'button',
      }),
      root({
        'data-test-step-kind': 'quiz',
        'data-test-step-id': 'quiz-1',
      }),
    ]);

    const result = await discoverStepsFromDOM(page);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ stepKind: 'plain', stepId: 'plain-1', index: 0 });
    expect(result.coverage).toEqual({
      contractSource: 'current',
      rendered: 2,
      supported: 1,
      executed: 0,
      unsupported: 1,
      unsupportedSteps: [{ stepKind: 'quiz', stepId: 'quiz-1' }],
    });
  });

  it('uses the legacy fallback when current roots are absent', async () => {
    const page = pageWithRoots(
      [],
      [
        root({ 'data-testid': 'interactive-step-plain-1', 'data-targetaction': 'button' }),
        root({
          'data-testid': 'interactive-step-multi-1',
          'data-targetaction': 'multistep',
          'data-internal-actions': '[{},{}]',
        }),
        root({
          'data-testid': 'interactive-step-guided-1',
          'data-test-substep-total': '3',
        }),
      ]
    );

    const result = await discoverStepsFromDOM(page);

    expect(result.coverage.contractSource).toBe('legacy');
    expect(result.steps.map(({ stepKind, stepId }) => ({ stepKind, stepId }))).toEqual([
      { stepKind: 'plain', stepId: 'plain-1' },
      { stepKind: 'multistep', stepId: 'multi-1' },
      { stepKind: 'guided', stepId: 'guided-1' },
    ]);
  });

  it('uses the current contract when both contract generations are present', async () => {
    const page = pageWithRoots(
      [root({ 'data-test-step-kind': 'plain', 'data-test-step-id': 'current-1' })],
      [root({ 'data-testid': 'interactive-step-legacy-1' })]
    );

    const result = await discoverStepsFromDOM(page);

    expect(result.coverage.contractSource).toBe('current');
    expect(result.steps.map((step) => step.stepId)).toEqual(['current-1']);
  });

  it('uses a legacy selector that excludes completed badges', async () => {
    const page = pageWithRoots([]);

    await discoverStepsFromDOM(page);

    expect(LEGACY_STEP_SELECTOR).toContain(':not([data-testid^="interactive-step-completed-"])');
    expect(page.locator).toHaveBeenCalledWith(LEGACY_STEP_SELECTOR);
  });
});

describe('withExecutedCoverage', () => {
  it('counts reached supported steps without changing unsupported coverage', () => {
    const coverage = withExecutedCoverage(
      {
        contractSource: 'current',
        rendered: 3,
        supported: 2,
        executed: 0,
        unsupported: 1,
        unsupportedSteps: [{ stepKind: 'quiz', stepId: 'quiz-1' }],
      },
      [
        {
          stepId: 'plain-1',
          stepKind: 'plain',
          status: 'passed',
          durationMs: 1,
          currentUrl: '/',
          consoleErrors: [],
          skippable: false,
        },
        {
          stepId: 'guided-1',
          stepKind: 'guided',
          status: 'not_reached',
          durationMs: 0,
          currentUrl: '/',
          consoleErrors: [],
          skippable: false,
        },
      ]
    );

    expect(coverage).toMatchObject({ rendered: 3, supported: 2, executed: 1, unsupported: 1 });
  });
});
