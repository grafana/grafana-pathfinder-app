import { renderHook, act } from '@testing-library/react';
import { useGuideOperations } from './useGuideOperations';
import type { JsonGuide } from '../types';
import blockEditorTutorial from '../../../bundled-interactives/block-editor-tutorial/content.json';

function makeOps(overrides: Partial<Parameters<typeof useGuideOperations>[0]> = {}) {
  const loadGuide = jest.fn();
  const editor = {
    getGuide: jest.fn(() => ({ id: 'x', title: 'x', blocks: [] })),
    loadGuide,
    resetGuide: jest.fn(),
  };

  const { result } = renderHook(() =>
    useGuideOperations({
      editor,
      persistence: { clear: jest.fn() },
      recordingPersistence: { clear: jest.fn() },
      actionRecorder: { clearRecording: jest.fn() },
      recordingState: { reset: jest.fn() },
      modals: { close: jest.fn() },
      ...overrides,
    })
  );

  return { result, loadGuide };
}

describe('useGuideOperations — handleLoadTemplate', () => {
  it('mints a distinct resource id on each example load so copies do not collide', () => {
    const { result, loadGuide } = makeOps();

    act(() => {
      result.current.handleLoadTemplate();
      result.current.handleLoadTemplate();
    });

    expect(loadGuide).toHaveBeenCalledTimes(2);
    const first = loadGuide.mock.calls[0][0] as JsonGuide;
    const second = loadGuide.mock.calls[1][0] as JsonGuide;

    expect(first.id).not.toBe(blockEditorTutorial.id);
    expect(second.id).not.toBe(blockEditorTutorial.id);
    expect(first.id).not.toBe(second.id);
    expect(first.title).toBe(blockEditorTutorial.title);
    expect(second.title).toBe(blockEditorTutorial.title);
  });

  it('avoids library resource names already claimed by a prior example load', () => {
    const claimed: string[] = [];
    const { result, loadGuide } = makeOps({
      getExistingResourceNames: () => claimed,
    });

    act(() => {
      result.current.handleLoadTemplate();
    });
    claimed.push((loadGuide.mock.calls[0][0] as JsonGuide).id);

    act(() => {
      result.current.handleLoadTemplate();
    });

    const secondId = (loadGuide.mock.calls[1][0] as JsonGuide).id;
    expect(secondId).not.toBe(claimed[0]);
    expect(claimed).not.toContain(secondId);
  });
});
