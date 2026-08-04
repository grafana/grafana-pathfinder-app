import { renderHook, act } from '@testing-library/react';
import { generateUniqueId, useGuideOperations } from './useGuideOperations';
import type { JsonGuide } from '../types';
import blockEditorTutorial from '../../../bundled-interactives/block-editor-tutorial/content.json';

function makeOps(overrides: Partial<Parameters<typeof useGuideOperations>[0]> = {}) {
  const loadGuide = jest.fn();
  const editor = {
    getGuide: jest.fn(() => ({ id: 'x', title: 'x', blocks: [] })),
    loadGuide,
  };

  const { result } = renderHook(() =>
    useGuideOperations({
      editor,
      modals: { close: jest.fn() },
      ...overrides,
    })
  );

  return { result, loadGuide };
}

describe('generateUniqueId', () => {
  it('avoids ids already present in existingNames', () => {
    const existing: string[] = [];
    for (let i = 0; i < 30; i++) {
      existing.push(generateUniqueId('Hello', existing));
    }
    expect(new Set(existing).size).toBe(30);
  });
});

describe('useGuideOperations — handleLoadTemplate', () => {
  it('loads the bundled tutorial as-is (same id as the template)', () => {
    const { result, loadGuide } = makeOps();

    act(() => {
      result.current.handleLoadTemplate();
    });

    expect(loadGuide).toHaveBeenCalledWith(blockEditorTutorial);
    expect((loadGuide.mock.calls[0][0] as JsonGuide).id).toBe(blockEditorTutorial.id);
  });
});
