/**
 * Tests for useModalManager hook
 */

import { renderHook, act } from '@testing-library/react';
import { useModalManager } from './useModalManager';

describe('useModalManager', () => {
  it('starts with all modals closed', () => {
    const { result } = renderHook(() => useModalManager());

    expect(result.current.isOpen('metadata')).toBe(false);
    expect(result.current.isOpen('newGuideConfirm')).toBe(false);
    expect(result.current.isOpen('import')).toBe(false);
    expect(result.current.isOpen('githubPr')).toBe(false);
    expect(result.current.isOpen('tour')).toBe(false);
  });

  it('opens a modal', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('metadata');
    });

    expect(result.current.isOpen('metadata')).toBe(true);
  });

  it('closes a modal', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('metadata');
    });
    expect(result.current.isOpen('metadata')).toBe(true);

    act(() => {
      result.current.close('metadata');
    });
    expect(result.current.isOpen('metadata')).toBe(false);
  });

  it('toggles a modal open', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.toggle('import');
    });
    expect(result.current.isOpen('import')).toBe(true);
  });

  it('toggles a modal closed', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('import');
    });
    expect(result.current.isOpen('import')).toBe(true);

    act(() => {
      result.current.toggle('import');
    });
    expect(result.current.isOpen('import')).toBe(false);
  });

  it('allows multiple modals open simultaneously', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('metadata');
      result.current.open('tour');
    });

    expect(result.current.isOpen('metadata')).toBe(true);
    expect(result.current.isOpen('tour')).toBe(true);
    expect(result.current.isOpen('import')).toBe(false);
  });

  it('closing one modal does not affect others', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('metadata');
      result.current.open('tour');
    });

    act(() => {
      result.current.close('metadata');
    });

    expect(result.current.isOpen('metadata')).toBe(false);
    expect(result.current.isOpen('tour')).toBe(true);
  });

  it('closing an already closed modal is a no-op', () => {
    const { result } = renderHook(() => useModalManager());

    expect(result.current.isOpen('import')).toBe(false);

    act(() => {
      result.current.close('import');
    });

    expect(result.current.isOpen('import')).toBe(false);
  });

  it('opening an already open modal is a no-op', () => {
    const { result } = renderHook(() => useModalManager());

    act(() => {
      result.current.open('tour');
    });
    expect(result.current.isOpen('tour')).toBe(true);

    act(() => {
      result.current.open('tour');
    });
    expect(result.current.isOpen('tour')).toBe(true);
  });
});
