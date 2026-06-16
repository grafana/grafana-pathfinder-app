import React from 'react';
import { renderHook } from '@testing-library/react';
import { InteractiveReadonlyContext, useIsInteractiveReadonly } from './interactive-readonly-context';

describe('useIsInteractiveReadonly', () => {
  it('defaults to false outside a provider', () => {
    const { result } = renderHook(() => useIsInteractiveReadonly());
    expect(result.current).toBe(false);
  });

  it('returns the provided value within a provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <InteractiveReadonlyContext.Provider value={true}>{children}</InteractiveReadonlyContext.Provider>
    );
    const { result } = renderHook(() => useIsInteractiveReadonly(), { wrapper });
    expect(result.current).toBe(true);
  });
});
