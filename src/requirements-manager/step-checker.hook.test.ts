import { renderHook, act } from '@testing-library/react';
import { useStepChecker } from './index';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { checkRequirements } from './requirements-checker.utils';
import type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Mock requirements checker utility
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
}));

// Mock interactive-engine to control NavigationManager (lazy-imported) and useInteractiveElements
const mockExpandParentNavigationSection = jest.fn().mockResolvedValue(true);
const mockFixLocationRequirement = jest.fn().mockResolvedValue(undefined);
const mockFixNavigationRequirementsOnNavManager = jest.fn().mockResolvedValue(undefined);
const mockFixNavigationRequirementsFromHook = jest.fn().mockResolvedValue(undefined);
const mockCheckRequirementsFromData = jest
  .fn()
  .mockResolvedValue({ pass: true, requirements: '', error: [], canFix: false });

jest.mock('../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({
    checkRequirementsFromData: mockCheckRequirementsFromData,
    fixNavigationRequirements: mockFixNavigationRequirementsFromHook,
  })),
  useSequentialStepState: jest.fn(() => undefined),
  NavigationManager: jest.fn().mockImplementation(() => ({
    expandParentNavigationSection: mockExpandParentNavigationSection,
    fixLocationRequirement: mockFixLocationRequirement,
    fixNavigationRequirements: mockFixNavigationRequirementsOnNavManager,
  })),
}));

const mockCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

/**
 * Render the hook with sane defaults; allow the lazy NavigationManager import to resolve.
 */
async function renderStepChecker(overrides: Partial<UseStepCheckerProps> = {}) {
  const props: UseStepCheckerProps = {
    stepId: 'test-step',
    isEligibleForChecking: true,
    ...overrides,
  };
  const rendered = renderHook(() => useStepChecker(props));
  // Flush the lazy `import('../interactive-engine')` promise so navigationManagerRef.current is set.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

/**
 * Build a CheckResultError-shaped failed-requirement entry.
 */
function failedRequirement(overrides: {
  requirement: string;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
  error?: string;
}) {
  return {
    requirement: overrides.requirement,
    pass: false,
    error: overrides.error ?? `${overrides.requirement} not satisfied`,
    canFix: overrides.canFix ?? false,
    fixType: overrides.fixType,
    targetHref: overrides.targetHref,
    scrollContainer: overrides.scrollContainer,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default checkRequirements behavior: pass. Individual tests override.
  mockCheckRequirements.mockResolvedValue({
    pass: true,
    requirements: '',
    error: [],
  });
});

// =============================================================================
// EXISTING: heartbeat behavior (preserved verbatim except for shared mocks)
// =============================================================================
describe('useStepChecker heartbeat', () => {
  let callCount: number;

  beforeEach(() => {
    callCount = 0;

    mockCheckRequirements.mockImplementation(({ requirements }) => {
      // Toggle behavior: first call passes, second call fails for nav fragile case
      if (requirements?.includes('navmenu-open')) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
        }
        return Promise.resolve({
          pass: false,
          requirements: requirements || '',
          error: [{ requirement: 'navmenu-open', pass: false, error: 'Navigation menu not detected' }],
        });
      }
      return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
    });

    (INTERACTIVE_CONFIG as any).requirements.heartbeat.enabled = true;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.intervalMs = 50;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.watchWindowMs = 200;
  });

  it('reverts enabled step to disabled if fragile requirement becomes false', async () => {
    const { result } = renderHook(() =>
      useStepChecker({
        requirements: 'navmenu-open',
        objectives: undefined,
        hints: undefined,
        stepId: 'test-step',
        isEligibleForChecking: true,
      })
    );

    await act(async () => {
      await result.current.checkStep();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(result.current.isEnabled).toBe(false);
  });
});

// =============================================================================
// REGRESSION: fix dispatch — locks today's behavior before refactor (Phase B).
// =============================================================================
describe('useStepChecker fix dispatch (regression)', () => {
  it('dispatches expand-parent-navigation to NavigationManager.expandParentNavigationSection', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'expand-parent-navigation',
          targetHref: '/connections/datasources',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'exists-reftarget', refTarget: '#datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('expand-parent-navigation');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockExpandParentNavigationSection).toHaveBeenCalledWith('/connections/datasources');
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsOnNavManager).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsFromHook).not.toHaveBeenCalled();
  });

  it('dispatches location to NavigationManager.fixLocationRequirement', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'on-page:/explore',
      error: [
        failedRequirement({
          requirement: 'on-page:/explore',
          canFix: true,
          fixType: 'location',
          targetHref: '/explore',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'on-page:/explore' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('location');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockFixLocationRequirement).toHaveBeenCalledWith('/explore');
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsOnNavManager).not.toHaveBeenCalled();
  });

  it('dispatches expand-options-group by clicking collapsed Options group toggles in the DOM', async () => {
    // Set up two collapsed Options Group buttons in the DOM.
    document.body.innerHTML = `
      <button data-testid="data-testid Options group Standard" aria-expanded="false">Standard</button>
      <button data-testid="data-testid Options group Display" aria-expanded="false">Display</button>
      <button data-testid="data-testid Options group Already" aria-expanded="true">Already open</button>
    `;
    const collapsedOne = document.querySelector(
      '[data-testid="data-testid Options group Standard"]'
    ) as HTMLButtonElement;
    const collapsedTwo = document.querySelector(
      '[data-testid="data-testid Options group Display"]'
    ) as HTMLButtonElement;
    const alreadyOpen = document.querySelector(
      '[data-testid="data-testid Options group Already"]'
    ) as HTMLButtonElement;
    const clickOne = jest.spyOn(collapsedOne, 'click');
    const clickTwo = jest.spyOn(collapsedTwo, 'click');
    const clickOpen = jest.spyOn(alreadyOpen, 'click');

    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'expand-options-group',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'exists-reftarget' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.fixType).toBe('expand-options-group');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(clickOne).toHaveBeenCalledTimes(1);
    expect(clickTwo).toHaveBeenCalledTimes(1);
    expect(clickOpen).not.toHaveBeenCalled();

    document.body.innerHTML = '';
  });

  it('dispatches navigation to fixNavigationRequirements (from useInteractiveElements)', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'navmenu-open',
      error: [failedRequirement({ requirement: 'navmenu-open', canFix: true, fixType: 'navigation' })],
    });

    const { result } = await renderStepChecker({ requirements: 'navmenu-open' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('navigation');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockFixNavigationRequirementsFromHook).toHaveBeenCalledTimes(1);
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
  });

  it('does not call fixRequirement at all when canFixRequirement is false', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources', canFix: false })],
    });

    const { result } = await renderStepChecker({ requirements: 'has-datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(false);
    expect(result.current.fixRequirement).toBeUndefined();
    expect(mockFixNavigationRequirementsFromHook).not.toHaveBeenCalled();
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
  });

  it('preserves fix metadata when a fix handler reports failure so the user can retry', async () => {
    // The handler will throw to simulate a failed fix. The reducer's SET_ERROR
    // path defaults canFix to false and clears fix metadata, so the hook must
    // pass them explicitly — otherwise the fix button vanishes after one click.
    mockExpandParentNavigationSection.mockResolvedValueOnce(false);
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'expand-parent-navigation',
          targetHref: '/connections/datasources',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'exists-reftarget', refTarget: '#datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(result.current.error).toBeDefined();
    // The button must still be available for another attempt.
    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('expand-parent-navigation');
  });

  it('lazy-scroll: fixRequirement is a no-op so the action button remains available', async () => {
    // `lazy-scroll` is a hint for the action button (which runs the discovery
    // scroll via `tryLazyScrollAndExecute`). The fix-handler registry has no
    // entry for it; calling dispatchFix would return `{ ok: false }` and
    // clobber state. The hook must short-circuit instead.
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'lazy-scroll',
          scrollContainer: '#dashboard',
        }),
      ],
    });

    const { result } = await renderStepChecker({
      requirements: 'exists-reftarget',
      refTarget: '#far-away',
      lazyRender: true,
      scrollContainer: '#dashboard',
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('lazy-scroll');
    const errorBefore = result.current.error;

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsFromHook).not.toHaveBeenCalled();
    // State is unchanged: no spurious "No fix handler matched" error appears
    // and the metadata is preserved.
    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('lazy-scroll');
    expect(result.current.error).toBe(errorBefore);
  });
});

// =============================================================================
// REGRESSION: priority ordering — objectives > eligibility > requirements.
// Documents the contract at step-checker.hook.ts:1-10 before refactor (Phase C).
// =============================================================================
describe('useStepChecker priority ordering (regression)', () => {
  // After unification, objectives and requirements share a single underlying
  // `checkRequirements` call — so the priority contract is verified by which
  // requirement strings are passed, not by which mock function fires.

  function callsFor(requirementsString: string) {
    return mockCheckRequirements.mock.calls.filter(([opts]) => opts.requirements === requirementsString);
  }

  it('auto-completes via objectives and never checks the requirements string', async () => {
    mockCheckRequirements.mockImplementation(({ requirements }) =>
      Promise.resolve({
        pass: requirements === 'has-datasources',
        requirements: requirements || '',
        error: requirements === 'has-datasources' ? [] : [failedRequirement({ requirement: requirements || '' })],
      })
    );

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.completionReason).toBe('objectives');
    expect(callsFor('on-page:/explore')).toHaveLength(0);
  });

  it('blocks on ineligibility before checking the requirements string (objectives unmet)', async () => {
    mockCheckRequirements.mockImplementation(({ requirements }) =>
      Promise.resolve({
        pass: false,
        requirements: requirements || '',
        error: [failedRequirement({ requirement: requirements || '' })],
      })
    );

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
      isEligibleForChecking: false,
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.error).toBe('Sequential dependency not met');
    expect(callsFor('on-page:/explore')).toHaveLength(0);
  });

  it('falls through to the requirements string when objectives unmet and step is eligible', async () => {
    mockCheckRequirements.mockImplementation(({ requirements }) => {
      if (requirements === 'has-datasources') {
        return Promise.resolve({
          pass: false,
          requirements,
          error: [failedRequirement({ requirement: 'has-datasources' })],
        });
      }
      return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
    });

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
      isEligibleForChecking: true,
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.isCompleted).toBe(false);
    expect(callsFor('on-page:/explore').length).toBeGreaterThan(0);
  });

  // REGRESSION: a slow / hung objectives check (3s timeoutMs in the hook) used to
  // reject up to checkStep's outer catch and strand the step in an error state.
  // The legacy `checkConditions` swallowed the timeout and returned { pass: false },
  // letting the flow continue to Phase 2 (eligibility) and Phase 3 (requirements).
  // The objectives-check rejection only happens via Promise.race timeout (the
  // inner attemptCheck swallows checkRequirements rejections), so we use fake
  // timers and a hung objectives mock to drive that path.
  it('falls through to requirements when the objectives check times out', async () => {
    jest.useFakeTimers();
    // Silence the warning the production code emits on this fall-through path.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockCheckRequirements.mockImplementation(({ requirements }) => {
      if (requirements === 'has-datasources') {
        // Hang forever; the hook's 3s Promise.race timeout will reject for us.
        return new Promise(() => {});
      }
      return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
    });

    try {
      const rendered = renderHook(() =>
        useStepChecker({
          stepId: 'test-step',
          isEligibleForChecking: true,
          objectives: 'has-datasources',
          requirements: 'on-page:/explore',
        })
      );

      // Flush the lazy `import('../interactive-engine')` so navigationManagerRef is set.
      // Microtasks resolve under fake timers, but real `import()` does not — wrap
      // in act + real microtask flushes via Promise.resolve.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Kick off checkStep. The objectives check enters Promise.race and hangs.
      let checkStepPromise!: Promise<void>;
      await act(async () => {
        checkStepPromise = rendered.result.current.checkStep();
      });

      // Trip the 3000ms timeoutMs. Promise.race rejects; in the fixed code, the
      // inner try/catch turns that into "objectives unmet" and the flow continues.
      await act(async () => {
        jest.advanceTimersByTime(3001);
        await checkStepPromise;
      });

      expect(rendered.result.current.isEnabled).toBe(true);
      expect(rendered.result.current.isCompleted).toBe(false);
      expect(rendered.result.current.error).toBeUndefined();
      expect(callsFor('on-page:/explore').length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  // REGRESSION: when the objectives check resolves *before* the 3s timeoutMs
  // fires, the Promise.race timer used to leak — the setTimeout was never
  // cleared, so it would fire later and call reject() on an already-settled
  // promise. The fix attaches a .finally that calls clearTimeout. Verified by
  // asserting jest's pending-timer count returns to zero after settlement.
  it('clears the objectives-check timeout timer when the check resolves first', async () => {
    jest.useFakeTimers();

    mockCheckRequirements.mockResolvedValue({
      pass: false, // Don't auto-complete; just resolve quickly so we don't get stuck on objectives.
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources' })],
    });

    try {
      const rendered = renderHook(() =>
        useStepChecker({
          stepId: 'test-step',
          isEligibleForChecking: true,
          objectives: 'has-datasources',
        })
      );

      // Flush lazy `import('../interactive-engine')`.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const beforeTimers = jest.getTimerCount();

      await act(async () => {
        await rendered.result.current.checkStep();
      });

      // After settle, the 3s timeout from Promise.race must have been cleared.
      // We allow for unrelated heartbeat / re-render timers by asserting the
      // count did not *grow* — i.e. no leaked 3s timer is now pending.
      expect(jest.getTimerCount()).toBeLessThanOrEqual(beforeTimers);
    } finally {
      jest.useRealTimers();
    }
  });
});

// =============================================================================
// REGRESSION: return shape — locks the consumer-facing API before Phase D
// swaps useState for useReducer.
// =============================================================================
describe('useStepChecker return shape (regression)', () => {
  it('exposes the documented set of state fields and action methods', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: true,
      requirements: '',
      error: [],
    });

    const { result } = await renderStepChecker({ skippable: true });

    const value: UseStepCheckerReturn & Record<string, unknown> = result.current as any;

    // State fields (from the spread of `state` plus explicit overrides)
    expect(value).toHaveProperty('isEnabled');
    expect(value).toHaveProperty('isCompleted');
    expect(value).toHaveProperty('isChecking');
    expect(value).toHaveProperty('isSkipped');
    expect(value).toHaveProperty('completionReason');
    expect(value).toHaveProperty('explanation');
    expect(value).toHaveProperty('error');
    expect(value).toHaveProperty('canFixRequirement');
    expect(value).toHaveProperty('canSkip');
    expect(value).toHaveProperty('fixType');
    expect(value).toHaveProperty('targetHref');
    expect(value).toHaveProperty('scrollContainer');
    expect(value).toHaveProperty('retryCount');
    expect(value).toHaveProperty('maxRetries');
    expect(value).toHaveProperty('isRetrying');

    // Action methods
    expect(typeof value.checkStep).toBe('function');
    expect(typeof value.markCompleted).toBe('function');
    expect(typeof value.resetStep).toBe('function');

    // Conditional methods (depend on skippable / canFixRequirement)
    expect(typeof value.markSkipped).toBe('function'); // skippable: true above
  });

  it('omits markSkipped when skippable is false', async () => {
    const { result } = await renderStepChecker({ skippable: false });
    expect(result.current.markSkipped).toBeUndefined();
  });

  it('omits fixRequirement when canFixRequirement is false', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources', canFix: false })],
    });

    const { result } = await renderStepChecker({ requirements: 'has-datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(false);
    expect(result.current.fixRequirement).toBeUndefined();
  });

  it('exposes fixRequirement as a function when canFixRequirement is true', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'navmenu-open',
      error: [failedRequirement({ requirement: 'navmenu-open', canFix: true, fixType: 'navigation' })],
    });

    const { result } = await renderStepChecker({ requirements: 'navmenu-open' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(typeof result.current.fixRequirement).toBe('function');
  });
});
