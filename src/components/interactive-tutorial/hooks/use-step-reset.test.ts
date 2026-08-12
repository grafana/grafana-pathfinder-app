/**
 * Unit tests for the shared step-reset plumbing.
 *
 * Both halves exist because a step's state lives in two places the section
 * cannot reach — its own local state and its requirements FSM — and steps that
 * answered the reset signal in only one of them (or not at all) left
 * completions and skips that no reset could clear.
 */

import { renderHook } from '@testing-library/react';

import { resetStep } from '../../../global-state/completion-store';
import { useStepRedo, useStepResetSignal } from './use-step-reset';

jest.mock('../../../global-state/completion-store', () => ({
  resetStep: jest.fn(),
}));

const mockResetStepInStore = resetStep as jest.MockedFunction<typeof resetStep>;

beforeEach(() => {
  mockResetStepInStore.mockClear();
});

describe('useStepResetSignal', () => {
  it('does nothing on mount', () => {
    const clearLocalState = jest.fn();
    const resetChecker = jest.fn();

    renderHook(() => useStepResetSignal({ resetTrigger: 0, clearLocalState, resetChecker }));

    expect(clearLocalState).not.toHaveBeenCalled();
    expect(resetChecker).not.toHaveBeenCalled();
  });

  it('ignores a standalone step, which never gets the signal', () => {
    const clearLocalState = jest.fn();

    renderHook(() => useStepResetSignal({ resetTrigger: undefined, clearLocalState }));

    expect(clearLocalState).not.toHaveBeenCalled();
  });

  it('clears local state and the requirements FSM when the section bumps the trigger', () => {
    const clearLocalState = jest.fn();
    const resetChecker = jest.fn();
    const { rerender } = renderHook(
      ({ resetTrigger }) => useStepResetSignal({ resetTrigger, clearLocalState, resetChecker }),
      { initialProps: { resetTrigger: 0 } }
    );

    rerender({ resetTrigger: 1 });

    expect(clearLocalState).toHaveBeenCalledTimes(1);
    // The section already wrote the store for the whole tail; a second write
    // from here would fan out over the steps the user kept completed.
    expect(resetChecker).toHaveBeenCalledWith({ skipStoreWrite: true });
  });

  it('answers every subsequent reset, not just the first', () => {
    const clearLocalState = jest.fn();
    const { rerender } = renderHook(({ resetTrigger }) => useStepResetSignal({ resetTrigger, clearLocalState }), {
      initialProps: { resetTrigger: 0 },
    });

    rerender({ resetTrigger: 1 });
    rerender({ resetTrigger: 2 });

    expect(clearLocalState).toHaveBeenCalledTimes(2);
  });

  it('tolerates a step with no requirements checker', () => {
    const clearLocalState = jest.fn();
    const { rerender } = renderHook(({ resetTrigger }) => useStepResetSignal({ resetTrigger, clearLocalState }), {
      initialProps: { resetTrigger: 0 },
    });

    expect(() => rerender({ resetTrigger: 1 })).not.toThrow();
    expect(clearLocalState).toHaveBeenCalledTimes(1);
  });
});

describe('useStepRedo', () => {
  it('delegates to the section so the steps after this one re-lock too', () => {
    const onStepReset = jest.fn();
    const clearLocalState = jest.fn();
    const resetChecker = jest.fn();
    const { result } = renderHook(() =>
      useStepRedo({ stepId: 'sec-step-2', sectionId: 'sec', onStepReset, clearLocalState, resetChecker })
    );

    result.current();

    expect(onStepReset).toHaveBeenCalledWith('sec-step-2');
    expect(clearLocalState).toHaveBeenCalledTimes(1);
    expect(resetChecker).toHaveBeenCalledWith({ skipStoreWrite: true });
    // The section owns the store write for the tail.
    expect(mockResetStepInStore).not.toHaveBeenCalled();
  });

  it('clears its own store entry when no section owns it', () => {
    const clearLocalState = jest.fn();
    const resetChecker = jest.fn();
    const { result } = renderHook(() =>
      useStepRedo({ stepId: 'lonely-step', sectionId: undefined, clearLocalState, resetChecker })
    );

    result.current();

    expect(mockResetStepInStore).toHaveBeenCalledWith('lonely-step', undefined);
    expect(clearLocalState).toHaveBeenCalledTimes(1);
    expect(resetChecker).toHaveBeenCalledWith();
  });
});
