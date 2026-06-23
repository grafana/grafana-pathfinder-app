import { renderHook } from '@testing-library/react';
import { useInteractiveMode } from './interactive-mode-context';

describe('useInteractiveMode', () => {
  it('defaults to interactive outside a provider', () => {
    const { result } = renderHook(() => useInteractiveMode());
    expect(result.current).toBe('interactive');
  });
});
