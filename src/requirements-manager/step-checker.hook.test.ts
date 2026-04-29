import { renderHook, act } from '@testing-library/react';
import { useStepChecker } from './index';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { checkRequirements } from './requirements-checker.utils';
import type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Mock requirements checker utility
jest.mock('./requirements-checker.utils', () => ({
  checkRequirements: jest.fn(),
}));

// Mock interactive-engine to control NavigationManager (lazy-imported) and useInteractiveElements
const mockExpandParentNavigationSection = jest.fn().mockResolvedValue(true);
const mockFixLocationRequirement = jest.fn().mockResolvedValue(undefined);
const mockFixNavigationRequirementsOnNavManager = jest.fn().mockResolvedValue(undefined);
const mockFixNavigationRequirementsFromHook = jest.fn().mockResolvedValue(undefined);
const mockCheckRequirementsFromData = jest
  .fn()
  .mockResolvedValue({ pass: true, requirements: '', error: [], canFix: false });

jest.mock('../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({
    checkRequirementsFromData: mockCheckRequirementsFromData,
    fixNavigationRequirements: mockFixNavigationRequirementsFromHook,
  })),
  useSequentialStepState: jest.fn(() => undefined),
  NavigationManager: jest.fn().mockImplementation(() => ({
    expandParentNavigationSection: mockExpandParentNavigationSection,
    fixLocationRequirement: mockFixLocationRequirement,
    fixNavigationRequirements: mockFixNavigationRequirementsOnNavManager,
  })),
}));

const mockCheckRequirements = checkRequirements as jest.MockedFunction<typeof checkRequirements>;

/**
 * Render the hook with sane defaults; allow the lazy NavigationManager import to resolve.
 */
async function renderStepChecker(overrides: Partial<UseStepCheckerProps> = {}) {
  const props: UseStepCheckerProps = {
    stepId: 'test-step',
    isEligibleForChecking: true,
    ...overrides,
  };
  const rendered = renderHook(() => useStepChecker(props));
  // Flush the lazy `import('../interactive-engine')` promise so navigationManagerRef.current is set.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

/**
 * Build a CheckResultError-shaped failed-requirement entry.
 */
function failedRequirement(overrides: {
  requirement: string;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
  error?: string;
}) {
  return {
    requirement: overrides.requirement,
    pass: false,
    error: overrides.error ?? `${overrides.requirement} not satisfied`,
    canFix: overrides.canFix ?? false,
    fixType: overrides.fixType,
    targetHref: overrides.targetHref,
    scrollContainer: overrides.scrollContainer,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default checkRequirements behavior: pass. Individual tests override.
  mockCheckRequirements.mockResolvedValue({
    pass: true,
    requirements: '',
    error: [],
  });
});

// =============================================================================
// EXISTING: heartbeat behavior (preserved verbatim except for shared mocks)
// =============================================================================
describe('useStepChecker heartbeat', () => {
  let callCount: number;

  beforeEach(() => {
    callCount = 0;

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

    (INTERACTIVE_CONFIG as any).requirements.heartbeat.enabled = true;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.intervalMs = 50;
    (INTERACTIVE_CONFIG as any).requirements.heartbeat.watchWindowMs = 200;
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

    await act(async () => {
      await result.current.checkStep();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(result.current.isEnabled).toBe(false);
  });
});

// =============================================================================
// REGRESSION: fix dispatch — locks today's behavior before refactor (Phase B).
// =============================================================================
describe('useStepChecker fix dispatch (regression)', () => {
  it('dispatches expand-parent-navigation to NavigationManager.expandParentNavigationSection', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'expand-parent-navigation',
          targetHref: '/connections/datasources',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'exists-reftarget', refTarget: '#datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('expand-parent-navigation');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockExpandParentNavigationSection).toHaveBeenCalledWith('/connections/datasources');
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsOnNavManager).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsFromHook).not.toHaveBeenCalled();
  });

  it('dispatches location to NavigationManager.fixLocationRequirement', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'on-page:/explore',
      error: [
        failedRequirement({
          requirement: 'on-page:/explore',
          canFix: true,
          fixType: 'location',
          targetHref: '/explore',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'on-page:/explore' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('location');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockFixLocationRequirement).toHaveBeenCalledWith('/explore');
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixNavigationRequirementsOnNavManager).not.toHaveBeenCalled();
  });

  it('dispatches expand-options-group by clicking collapsed Options group toggles in the DOM', async () => {
    // Set up two collapsed Options Group buttons in the DOM.
    document.body.innerHTML = `
      <button data-testid="data-testid Options group Standard" aria-expanded="false">Standard</button>
      <button data-testid="data-testid Options group Display" aria-expanded="false">Display</button>
      <button data-testid="data-testid Options group Already" aria-expanded="true">Already open</button>
    `;
    const collapsedOne = document.querySelector(
      '[data-testid="data-testid Options group Standard"]'
    ) as HTMLButtonElement;
    const collapsedTwo = document.querySelector(
      '[data-testid="data-testid Options group Display"]'
    ) as HTMLButtonElement;
    const alreadyOpen = document.querySelector(
      '[data-testid="data-testid Options group Already"]'
    ) as HTMLButtonElement;
    const clickOne = jest.spyOn(collapsedOne, 'click');
    const clickTwo = jest.spyOn(collapsedTwo, 'click');
    const clickOpen = jest.spyOn(alreadyOpen, 'click');

    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'exists-reftarget',
      error: [
        failedRequirement({
          requirement: 'exists-reftarget',
          canFix: true,
          fixType: 'expand-options-group',
        }),
      ],
    });

    const { result } = await renderStepChecker({ requirements: 'exists-reftarget' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.fixType).toBe('expand-options-group');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(clickOne).toHaveBeenCalledTimes(1);
    expect(clickTwo).toHaveBeenCalledTimes(1);
    expect(clickOpen).not.toHaveBeenCalled();

    document.body.innerHTML = '';
  });

  it('dispatches navigation to fixNavigationRequirements (from useInteractiveElements)', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'navmenu-open',
      error: [failedRequirement({ requirement: 'navmenu-open', canFix: true, fixType: 'navigation' })],
    });

    const { result } = await renderStepChecker({ requirements: 'navmenu-open' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(result.current.fixType).toBe('navigation');

    await act(async () => {
      await result.current.fixRequirement?.();
    });

    expect(mockFixNavigationRequirementsFromHook).toHaveBeenCalledTimes(1);
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
  });

  it('does not call fixRequirement at all when canFixRequirement is false', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources', canFix: false })],
    });

    const { result } = await renderStepChecker({ requirements: 'has-datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(false);
    expect(result.current.fixRequirement).toBeUndefined();
    expect(mockFixNavigationRequirementsFromHook).not.toHaveBeenCalled();
    expect(mockExpandParentNavigationSection).not.toHaveBeenCalled();
    expect(mockFixLocationRequirement).not.toHaveBeenCalled();
  });
});

// =============================================================================
// REGRESSION: priority ordering — objectives > eligibility > requirements.
// Documents the contract at step-checker.hook.ts:1-10 before refactor (Phase C).
// =============================================================================
describe('useStepChecker priority ordering (regression)', () => {
  it('auto-completes via objectives without ever calling checkRequirements', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({
      pass: true,
      requirements: 'has-datasources',
      error: [],
    });

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.completionReason).toBe('objectives');
    expect(mockCheckRequirements).not.toHaveBeenCalled();
  });

  it('blocks on ineligibility before checking requirements (objectives unmet)', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources' })],
    });

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
      isEligibleForChecking: false,
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.error).toBe('Sequential dependency not met');
    expect(mockCheckRequirements).not.toHaveBeenCalled();
  });

  it('falls through to requirements when objectives unmet and step is eligible', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources' })],
    });
    mockCheckRequirements.mockResolvedValue({
      pass: true,
      requirements: 'on-page:/explore',
      error: [],
    });

    const { result } = await renderStepChecker({
      objectives: 'has-datasources',
      requirements: 'on-page:/explore',
      isEligibleForChecking: true,
    });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.isCompleted).toBe(false);
    expect(mockCheckRequirements).toHaveBeenCalled();
  });
});

// =============================================================================
// REGRESSION: return shape — locks the consumer-facing API before Phase D
// swaps useState for useReducer.
// =============================================================================
describe('useStepChecker return shape (regression)', () => {
  it('exposes the documented set of state fields and action methods', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: true,
      requirements: '',
      error: [],
    });

    const { result } = await renderStepChecker({ skippable: true });

    const value: UseStepCheckerReturn & Record<string, unknown> = result.current as any;

    // State fields (from the spread of `state` plus explicit overrides)
    expect(value).toHaveProperty('isEnabled');
    expect(value).toHaveProperty('isCompleted');
    expect(value).toHaveProperty('isChecking');
    expect(value).toHaveProperty('isSkipped');
    expect(value).toHaveProperty('completionReason');
    expect(value).toHaveProperty('explanation');
    expect(value).toHaveProperty('error');
    expect(value).toHaveProperty('canFixRequirement');
    expect(value).toHaveProperty('canSkip');
    expect(value).toHaveProperty('fixType');
    expect(value).toHaveProperty('targetHref');
    expect(value).toHaveProperty('scrollContainer');
    expect(value).toHaveProperty('retryCount');
    expect(value).toHaveProperty('maxRetries');
    expect(value).toHaveProperty('isRetrying');

    // Action methods
    expect(typeof value.checkStep).toBe('function');
    expect(typeof value.markCompleted).toBe('function');
    expect(typeof value.resetStep).toBe('function');

    // Conditional methods (depend on skippable / canFixRequirement)
    expect(typeof value.markSkipped).toBe('function'); // skippable: true above
  });

  it('omits markSkipped when skippable is false', async () => {
    const { result } = await renderStepChecker({ skippable: false });
    expect(result.current.markSkipped).toBeUndefined();
  });

  it('omits fixRequirement when canFixRequirement is false', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'has-datasources',
      error: [failedRequirement({ requirement: 'has-datasources', canFix: false })],
    });

    const { result } = await renderStepChecker({ requirements: 'has-datasources' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(false);
    expect(result.current.fixRequirement).toBeUndefined();
  });

  it('exposes fixRequirement as a function when canFixRequirement is true', async () => {
    mockCheckRequirements.mockResolvedValue({
      pass: false,
      requirements: 'navmenu-open',
      error: [failedRequirement({ requirement: 'navmenu-open', canFix: true, fixType: 'navigation' })],
    });

    const { result } = await renderStepChecker({ requirements: 'navmenu-open' });

    await act(async () => {
      await result.current.checkStep();
    });

    expect(result.current.canFixRequirement).toBe(true);
    expect(typeof result.current.fixRequirement).toBe('function');
  });
});
