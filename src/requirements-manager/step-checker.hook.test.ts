import type React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useStepChecker } from './index';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { checkRequirements } from './requirements-checker.utils';
import type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Raise the per-test timeout from jest's 5000ms default. This file exercises
// real timer-driven fix flows (`timeoutManager.setTimeout(fix-recheck-…)`,
// `timeoutManager.setTimeout(skip-reactive-check-…)`, the lazy
// `import('../interactive-engine')` for NavigationManager) that can each
// account for 1-2s on a constrained CI worker. The 5s default leaves no
// headroom and produces a cascading "Cannot read properties of null"
// failure mode where the first test times out and shared NavigationManager
// mock state corrupts every subsequent test in the file.
jest.setTimeout(15000);

// Mock requirements checker utility
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
}));

// The alignment-pending context is a Tier 1 dependency the hook reads to decide
// whether to gate `isEligibleForChecking`. Mock it explicitly so the default
// behaviour (paused=false) is deterministic; the "AlignmentPendingContext
// gate" describe block overrides the mock per-test.
jest.mock('../global-state/alignment-pending-context', () => ({
  AlignmentPendingContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
  useIsAlignmentPaused: jest.fn(() => false),
  useAlignmentStartingLocation: jest.fn(() => null),
}));

const mockUseIsAlignmentPaused = jest.requireMock('../global-state/alignment-pending-context')
  .useIsAlignmentPaused as jest.Mock;

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
// REGRESSION: heartbeat re-check loop — locks the runtime behavior of the
// `useEffect` at step-checker.hook.ts:823-868 that periodically rechecks
// fragile DOM-state requirements (`navmenu-open`, `exists-reftarget`,
// `on-page:`) and reverts a step from enabled back to blocked when the
// underlying state drifts.
//
// The reducer transition itself (SET_ERROR → blocked) is covered in
// `step-state.test.ts`, and the per-fix-type dispatch tests below cover
// `checkStep` end-to-end with a manual call. Neither exercises the
// scheduling effect — without this test, the heartbeat config gating, the
// fragility string-match, the `state.isCompleted || !state.isEnabled`
// short-circuit, and the cleanup-on-disable path have no regression cover
// and could be silently broken by future edits.
//
// History: a real-timer + `waitFor` version of this test (removed in
// f3405b35) flaked under `--maxWorkers 4` because the mount-effect's
// auto-checkStep raced the manual checkStep, the 200ms post-enable
// settling guard short-circuited the second call, and the 3s waitFor
// timed out under contention. Fake timers + `advanceTimersByTimeAsync`
// remove all three races: we control `Date.now`, the heartbeat's
// `setTimeout`, and the microtask flush in a single deterministic step.
// =============================================================================
describe('useStepChecker heartbeat (regression)', () => {
  let originalHeartbeat: typeof INTERACTIVE_CONFIG.requirements.heartbeat;

  beforeEach(() => {
    // Snapshot/restore so heartbeat tweaks don't leak into other describe blocks.
    originalHeartbeat = { ...INTERACTIVE_CONFIG.requirements.heartbeat };
    (INTERACTIVE_CONFIG as any).requirements.heartbeat = {
      enabled: true,
      onlyForFragile: true,
      intervalMs: 50,
      watchWindowMs: 5000,
    };
  });

  afterEach(() => {
    (INTERACTIVE_CONFIG as any).requirements.heartbeat = originalHeartbeat;
  });

  it('reverts isEnabled from true to false when a fragile requirement (navmenu-open) becomes false on a heartbeat tick', async () => {
    jest.useFakeTimers();
    try {
      // Phase 1: requirement passes — step settles to enabled.
      mockCheckRequirements.mockResolvedValue({ pass: true, requirements: 'navmenu-open', error: [] });

      const { result } = renderHook(() =>
        useStepChecker({
          requirements: 'navmenu-open',
          stepId: 'heartbeat-step',
          isEligibleForChecking: true,
        })
      );

      // Flush mount-effect microtasks and the lazy `import('../interactive-engine')`
      // promise so navigationManagerRef is set before checkStep runs.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.checkStep();
      });

      expect(result.current.isEnabled).toBe(true);

      // Phase 2: flip the mock so the next check fails — simulating the
      // navigation menu closing after the step was enabled. This is exactly
      // the drift the heartbeat is designed to detect.
      mockCheckRequirements.mockResolvedValue({
        pass: false,
        requirements: 'navmenu-open',
        error: [
          {
            requirement: 'navmenu-open',
            pass: false,
            error: 'Navigation menu not detected',
            canFix: false,
          },
        ],
      });

      // Advance past:
      //   - the heartbeat's initial delay (intervalMs + 500ms = 550ms)
      //   - the 200ms post-enable settling guard inside checkStep
      // → the first heartbeat tick fires, calls checkStepRef.current(),
      //   the requirement fails, the reducer dispatches SET_ERROR, and
      //   isEnabled flips back to false.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(800);
      });

      expect(result.current.isEnabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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

// =============================================================================
// AlignmentPendingContext gating — pauses checks while the implied 0th step
// is pending so step 1 can't race the user's redirect decision.
// =============================================================================
describe('useStepChecker — AlignmentPendingContext gate', () => {
  afterEach(() => {
    // Reset the mock to its default so pre-existing tests are not affected.
    mockUseIsAlignmentPaused.mockReturnValue(false);
  });

  it('does not call checkRequirements when the context returns isPending: true', async () => {
    mockUseIsAlignmentPaused.mockReturnValue(true);
    mockCheckRequirements.mockResolvedValue({ pass: true, requirements: 'navmenu-open', error: [] });

    const { result } = renderHook(() =>
      useStepChecker({
        requirements: 'navmenu-open',
        stepId: 'paused-step',
        isEligibleForChecking: true,
      })
    );

    await act(async () => {
      await result.current.checkStep();
    });

    expect(mockCheckRequirements).not.toHaveBeenCalled();
    expect(result.current.isEnabled).toBe(false);
  });

  it('runs checkRequirements normally when the context returns isPending: false', async () => {
    mockUseIsAlignmentPaused.mockReturnValue(false);
    mockCheckRequirements.mockResolvedValue({ pass: true, requirements: 'navmenu-open', error: [] });

    const { result } = renderHook(() =>
      useStepChecker({
        requirements: 'navmenu-open',
        stepId: 'unpaused-step',
        isEligibleForChecking: true,
      })
    );

    await act(async () => {
      await result.current.checkStep();
    });

    expect(mockCheckRequirements).toHaveBeenCalled();
  });

  // Regression for the objectives-bypass bug: the alignment pause used to
  // gate only `isEligibleForChecking` (Phase 2). But `checkStep` runs
  // Phase 1 (objectives) *before* the eligibility gate — so a step whose
  // `objectives` selector happens to match the user's current page
  // would auto-complete (`SET_COMPLETED`, `completionReason: 'objectives'`)
  // and fire `onStepComplete`/`onComplete` while the alignment prompt was
  // still up, bypassing the intended pause and racing the user's redirect
  // decision.
  //
  // The fix adds a Phase 0 alignment-pause guard at the top of `checkStep`
  // that short-circuits to `blocked` regardless of which phases would
  // otherwise run. This test locks that behaviour.
  it('does NOT auto-complete via objectives when paused, even if the objectives selector passes', async () => {
    mockUseIsAlignmentPaused.mockReturnValue(true);
    // Both objectives and requirements checks would pass if reached — the
    // alignment-pause guard must short-circuit before either runs.
    mockCheckRequirements.mockResolvedValue({ pass: true, requirements: 'exists-reftarget', error: [] });

    const onStepComplete = jest.fn();
    const onComplete = jest.fn();

    const { result } = renderHook(() =>
      useStepChecker({
        objectives: 'exists-reftarget',
        requirements: 'exists-reftarget',
        targetAction: 'button',
        refTarget: 'submit',
        stepId: 'paused-objectives-step',
        isEligibleForChecking: true,
        onStepComplete,
        onComplete,
      })
    );

    await act(async () => {
      await result.current.checkStep();
    });

    // The objectives check must not have been dispatched to the underlying
    // requirements utility — Phase 0 short-circuits before Phase 1.
    expect(mockCheckRequirements).not.toHaveBeenCalled();
    // And critically: the step is NOT completed and the auto-complete
    // notifications never fired.
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.completionReason).not.toBe('objectives');
    expect(onStepComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    // Per the existing gate contract, `isEnabled` is false while paused.
    expect(result.current.isEnabled).toBe(false);
  });

  // The end-to-end "Continue here → step-1 Fix this" flow (dismiss the
  // alignment prompt → eligibility gate flips → step-1's requirement
  // checker re-runs and exposes `fixRequirement`) lives in E2E rather
  // than here. A unit-level version was tried but added ~1.5s of
  // `waitFor`-driven retry-cycle wall time, which on the constrained CI
  // runner pushed the first pre-existing test in this file past the
  // 5000ms per-test timeout — once that test timed out, the cascading
  // `Cannot read properties of null` errors took down the rest of the
  // suite. The two unit tests above cover the gate's pause/unpause
  // semantics deterministically; an E2E covers the full UX flow.
});
