/**
 * Tripwire — FSM ↔ completion-store bridge.
 *
 * Pins the contract that `useStepChecker`'s terminal transitions write
 * through to the canonical completion store on BOTH axes:
 *
 *   - Completion writes: `markCompleted` (manual), `markSkipped`, and
 *     the objectives auto-complete effect.
 *   - Reset writes: `resetStep` — added by the PR-#909 pushback fix to
 *     close the reset-axis divergence (the FSM dispatched RESET +
 *     updateManager but never cleared the store entry, so the next
 *     reload re-surfaced the stale "completed" state).
 *
 * Verifies all three completion reasons:
 *   - `'manual'`   — `markCompleted()` is called
 *   - `'skipped'`  — `markSkipped()` is called
 *   - `'objectives'` — `state.completionReason` becomes `'objectives'`
 *     via the requirements check (we drive this directly through a
 *     mocked checkRequirements result).
 *
 * Also verifies the `sectionId: null` opt-out on both axes — used by
 * the section's own objectives self-checker, which is NOT a real step.
 */

import { renderHook, act } from '@testing-library/react';

import { useStepChecker } from './index';
import { checkRequirements } from './requirements-checker.utils';
import { markStepCompleted, resetStep } from '../global-state/completion-store';

jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
}));

jest.mock('../global-state/alignment-pending-context', () => ({
  useIsAlignmentPaused: jest.fn(() => false),
  useAlignmentStartingLocation: jest.fn(() => null),
}));

jest.mock('../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({
    checkRequirementsFromData: jest.fn().mockResolvedValue({ pass: true, error: [] }),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
  })),
  useSequentialStepState: jest.fn(() => undefined),
  NavigationManager: jest.fn().mockImplementation(() => ({
    expandParentNavigationSection: jest.fn().mockResolvedValue(true),
    fixLocationRequirement: jest.fn().mockResolvedValue(undefined),
    fixNavigationRequirements: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Spy-mock the canonical store. The bridge in `step-checker.hook.ts`
// calls `markStepCompleted` / `resetStep` directly; we observe via
// these mocks.
jest.mock('../global-state/completion-store', () => ({
  markStepCompleted: jest.fn(),
  resetStep: jest.fn(),
  STANDALONE_SECTION_ID: '__standalone__',
}));

const mockMarkStepCompleted = markStepCompleted as jest.MockedFunction<typeof markStepCompleted>;
const mockResetStep = resetStep as jest.MockedFunction<typeof resetStep>;
const mockCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

beforeEach(() => {
  mockMarkStepCompleted.mockClear();
  mockResetStep.mockClear();
  mockCheckRequirements.mockResolvedValue({ pass: true, requirements: '', error: [] });
});

describe('useStepChecker → completion-store bridge', () => {
  it('writes manual completion to the store on markCompleted()', async () => {
    const { result } = renderHook(() =>
      useStepChecker({ stepId: 'step-1', sectionId: 'section-a', isEligibleForChecking: true })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.markCompleted();
    });

    expect(mockMarkStepCompleted).toHaveBeenCalledWith('step-1', 'section-a', 'manual');
  });

  it('writes skipped completion to the store on markSkipped() — closes the skip-divergence gap', async () => {
    const { result } = renderHook(() =>
      useStepChecker({
        stepId: 'step-skip',
        sectionId: 'section-a',
        isEligibleForChecking: true,
        skippable: true,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.markSkipped?.();
    });

    expect(mockMarkStepCompleted).toHaveBeenCalledWith('step-skip', 'section-a', 'skipped');
  });

  it('uses STANDALONE_SECTION_ID when sectionId is undefined — closes the standalone-objectives gap', async () => {
    const { result } = renderHook(() => useStepChecker({ stepId: 'lone-step', isEligibleForChecking: true }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.markCompleted();
    });

    expect(mockMarkStepCompleted).toHaveBeenCalledWith('lone-step', '__standalone__', 'manual');
  });

  it('skips the store write entirely when sectionId is null (section-own objectives self-checker)', async () => {
    const { result } = renderHook(() =>
      useStepChecker({
        stepId: 'section-self',
        sectionId: null,
        isEligibleForChecking: true,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.markCompleted();
    });
    act(() => {
      result.current.markSkipped?.();
    });

    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
  });

  it('writes objectives completion when state.completionReason becomes objectives', async () => {
    // checkRequirements returns objectives-satisfied → reducer transitions
    // to SET_COMPLETED with reason 'objectives' → bridge effect fires.
    mockCheckRequirements.mockResolvedValue({
      pass: true,
      requirements: 'has-datasource:prometheus',
      error: [],
      completionReason: 'objectives',
    } as unknown as Awaited<ReturnType<typeof checkRequirements>>);

    renderHook(() =>
      useStepChecker({
        stepId: 'step-obj',
        sectionId: 'section-a',
        objectives: 'has-datasource:prometheus',
        isEligibleForChecking: true,
      })
    );

    // Let the initial check + completion effect run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMarkStepCompleted).toHaveBeenCalledWith('step-obj', 'section-a', 'objectives');
  });

  it('writes store reset on resetStep() — closes the reset-divergence gap', async () => {
    const { result } = renderHook(() =>
      useStepChecker({ stepId: 'step-reset', sectionId: 'section-a', isEligibleForChecking: true })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.resetStep();
    });

    expect(mockResetStep).toHaveBeenCalledWith('step-reset', 'section-a');
  });

  it('uses STANDALONE_SECTION_ID for resetStep() when sectionId is undefined', async () => {
    const { result } = renderHook(() => useStepChecker({ stepId: 'lone-reset', isEligibleForChecking: true }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.resetStep();
    });

    expect(mockResetStep).toHaveBeenCalledWith('lone-reset', '__standalone__');
  });

  it('skips the store reset entirely when sectionId is null (section-own objectives self-checker)', async () => {
    const { result } = renderHook(() =>
      useStepChecker({ stepId: 'section-self', sectionId: null, isEligibleForChecking: true })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.resetStep();
    });

    expect(mockResetStep).not.toHaveBeenCalled();
  });

  // Broadcast-mode opt-out — added alongside the PR-#909 reset-fan-out fix.
  //
  // The section's `resetTrigger` mechanism bumps a counter that fires
  // `useEffect` in EVERY child step. Pre-fix, each child's effect called
  // `checker.resetStep()` which writes through to the store via
  // `writeStoreReset` — so a tail-reset of steps [N..end] would also have
  // every preceding child (step 0..N-1) silently clear its own store
  // entry, wiping completions the user wanted to keep.
  //
  // The section pre-clears the tail atomically via `resetSteps(tail, sectionId)`
  // BEFORE bumping `resetTrigger`. Callers in that broadcast position pass
  // `{ skipStoreWrite: true }` so the FSM-only reset doesn't fan out a
  // per-step store write. This tripwire pins the contract: a future
  // refactor that flips or removes the `skipStoreWrite` branch — and
  // re-introduces the fan-out — fails here.
  it('skips the store write when resetStep is called with { skipStoreWrite: true } — broadcast-mode opt-out', async () => {
    const { result } = renderHook(() =>
      useStepChecker({ stepId: 'step-tail', sectionId: 'section-a', isEligibleForChecking: true })
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.resetStep({ skipStoreWrite: true });
    });

    // FSM reset still fires (verified by the other resetStep tests above
    // which exercise the same code path with the option absent), but the
    // store write does NOT — section's `resetSteps` was the sole writer.
    expect(mockResetStep).not.toHaveBeenCalled();
  });
});
