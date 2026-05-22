/**
 * Tripwire — FSM → completion-store bridge.
 *
 * Pins the contract that `useStepChecker`'s three terminal transitions
 * (`markCompleted`, `markSkipped`, and the objectives auto-complete
 * effect) write through to the canonical completion store. The bridge
 * closes a pre-relocate divergence where the FSM thought the step was
 * done but the store had no entry — meaning skips and standalone
 * objectives auto-completions were lost on reload.
 *
 * Verifies all three reasons:
 *   - `'manual'`   — `markCompleted()` is called
 *   - `'skipped'`  — `markSkipped()` is called
 *   - `'objectives'` — `state.completionReason` becomes `'objectives'`
 *     via the requirements check (we drive this directly through a
 *     mocked checkRequirements result).
 *
 * Also verifies the `sectionId: null` opt-out — used by the section's
 * own objectives self-checker, which is NOT a real step.
 */

import { renderHook, act } from '@testing-library/react';

import { useStepChecker } from './index';
import { checkRequirements } from './requirements-checker.utils';
import { markStepCompleted } from '../global-state/completion-store';

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
// calls `markStepCompleted` directly; we observe via this mock.
jest.mock('../global-state/completion-store', () => ({
  markStepCompleted: jest.fn(),
  STANDALONE_SECTION_ID: '__standalone__',
}));

const mockMarkStepCompleted = markStepCompleted as jest.MockedFunction<typeof markStepCompleted>;
const mockCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

beforeEach(() => {
  mockMarkStepCompleted.mockClear();
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
});
