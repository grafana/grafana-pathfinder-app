import { renderHook, act } from '@testing-library/react';
import { useStepChecker } from './index';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { checkRequirements } from './requirements-checker.utils';

// Mock requirements checker utility
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
}));

// Type-safe mock reference
const mockCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

describe('useStepChecker heartbeat', () => {
  let callCount: number;

  beforeEach(() => {
    jest.clearAllMocks();
    callCount = 0;

    // Configure mock to track calls and toggle behavior
    mockCheckRequirements.mockImplementation(({ requirements }) => {
      // Toggle behavior: first call passes, second call fails for nav fragile case
      if (requirements?.includes('navmenu-open')) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
        }
        return Promise.resolve({
          pass: false,
          requirements: requirements || '',
          error: [{ requirement: 'navmenu-open', pass: false, error: 'Navigation menu not detected' }],
        });
      }
      return Promise.resolve({ pass: true, requirements: requirements || '', error: [] });
    });

    // Ensure heartbeat is enabled and short timings for test speed
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.enabled = true;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.intervalMs = 50;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.watchWindowMs = 200;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

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
