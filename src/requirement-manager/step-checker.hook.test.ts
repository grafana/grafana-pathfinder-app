import { renderHook, act } from '@testing-library/react';
import { useStepChecker } from './index';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

// Mock requirements checker utility to simulate nav toggle passing then failing
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn().mockImplementation(({ requirements }) => {
    // Toggle behavior: first call passes, second call fails for nav fragile case
    if (requirements?.includes('navmenu-open')) {
      const calls = (global as any).__navCalls || 0;
      (global as any).__navCalls = calls + 1;
      if (calls === 0) {
        return Promise.resolve({ pass: true, requirements, error: [] });
      }
      return Promise.resolve({
        pass: false,
        requirements,
        error: [{ requirement: 'navmenu-open', pass: false, error: 'Navigation menu not detected' }],
      });
    }
    return Promise.resolve({ pass: true, requirements, error: [] });
  }),
}));

describe('useStepChecker heartbeat', () => {
  beforeEach(() => {
    (global as any).__navCalls = 0;
    // Ensure heartbeat is enabled and short timings for test speed
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.enabled = true;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.intervalMs = 50;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.watchWindowMs = 200;
  });

  afterEach(() => {});

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

    // First check (mock returns pass on first call)
    await act(async () => {
      await result.current.checkStep();
    });

    // Heartbeat tick should recheck shortly; wait slightly beyond interval
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(result.current.isEnabled).toBe(false);
  });
});
