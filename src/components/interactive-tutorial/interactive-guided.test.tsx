/**
 * Tests for InteractiveGuided component — issue #786
 *
 * Regression test: when both block-level `skippable: true` AND step-level
 * `isSkippable: true` are set, two skip buttons can appear simultaneously:
 * one in the React idle-state UI and one in the DOM overlay created by the
 * guided handler. The fix ensures React commits the `executing` state update
 * (hiding the idle skip button) BEFORE the first DOM overlay is created.
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { deriveGuidedUiState, InteractiveGuided } from './interactive-guided';
import { useStepChecker } from '../../requirements-manager';
import { useStepChecker as useRealStepChecker } from '../../requirements-manager/step-checker.hook';
import { useAiFixEnabled } from '../../integrations/assistant-integration/use-ai-fix-enabled';
import { testIds } from '../../constants/testIds';
import type {
  GuidedAction,
  GuidedStepOptions,
  GuidedSubstepResult,
  GuidedSubstepStatus,
} from '../../types/interactive-actions.types';
import type { useControllerChannel } from '../../global-state/controller-channel';
import { markStepCompleted, resetStep } from '../../global-state/completion-store';

// ─── Mock @grafana/ui ────────────────────────────────────────────────────────
jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Icon: () => null,
}));

// ─── Mock @grafana/data ──────────────────────────────────────────────────────
jest.mock('@grafana/data', () => ({
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

const mockPublishAppEvent = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: mockPublishAppEvent }),
}));

// ─── Mock useAiFixEnabled (off) — avoids pulling @grafana/assistant, which this
//     suite's @grafana/ui mock would otherwise leave un-themed and crashing ─────
jest.mock('../../integrations/assistant-integration/use-ai-fix-enabled', () => ({
  useAiFixEnabled: jest.fn(() => false),
}));

// ─── Mock analytics (no-op) ──────────────────────────────────────────────────
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DoItButtonClick: 'do_it', StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn(() => ({})),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

jest.mock('../../constants', () => ({
  getConfigWithDefaults: jest.fn(() => ({})),
}));
jest.mock('../../constants/interactive-config', () => ({
  ...jest.requireActual('../../constants/interactive-config'),
  getInteractiveConfig: jest.fn(() => ({
    autoDetection: { enabled: false },
    guided: { stepTimeout: 120000, hoverDwell: 500 },
    delays: {},
  })),
}));

// ─── Mock DOM utils ──────────────────────────────────────────────────────────
jest.mock('../../lib/dom', () => ({
  findButtonByText: jest.fn().mockReturnValue([]),
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false }),
}));

// ─── Mock security ───────────────────────────────────────────────────────────
jest.mock('../../security', () => ({
  sanitizeDocumentationHTML: jest.fn((html: string) => html),
}));

let mockStoredCompleted = false;
let mockCompletionReason = 'none';
let mockInteractiveMode = 'interactive';
let mockControllerChannel: ReturnType<typeof useControllerChannel> = null;
const mockCheckGuidedRequirements = jest.fn().mockResolvedValue({ pass: true, error: [] });
jest.mock('../../global-state/interactive-mode-context', () => ({
  useInteractiveMode: () => mockInteractiveMode,
}));
jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: () => mockControllerChannel,
}));
const mockMarkSkipped = jest.fn(() => {
  mockStoredCompleted = true;
});

jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: mockStoredCompleted, reason: null })),
  markStepCompleted: jest.fn(() => {
    mockStoredCompleted = true;
  }),
  resetStep: jest.fn(() => {
    mockStoredCompleted = false;
  }),
  STANDALONE_SECTION_ID: '__standalone__',
}));

jest.mock('../../requirements-manager/guide-requirements-context', () => ({
  useGuideRequirements: () => ({
    checkRequirements: mockCheckGuidedRequirements,
    guideId: 'guide-owner',
    contentKey: 'bundled:guide-owner',
  }),
}));

jest.mock('../../context-engine', () => ({
  onContextChange: () => jest.fn(),
}));
jest.mock('../../requirements-manager', () => ({
  useGuideRequirements: jest.requireMock('../../requirements-manager/guide-requirements-context').useGuideRequirements,
  useStepChecker: jest.fn(() => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
    completionReason: mockCompletionReason,
    markSkipped: mockMarkSkipped,
    canFixRequirement: false,
    fixRequirement: null,
    checkStep: jest.fn(),
    isRetrying: false,
    retryCount: 0,
    maxRetries: 3,
  })),
  validateInteractiveRequirements: jest.fn(),
}));

// ─── Track call order for waitForReactUpdates vs executeGuidedStep ───────────
let callOrder: string[] = [];

// ─── Mock waitForReactUpdates ────────────────────────────────────────────────
jest.mock('../../lib/async-utils', () => ({
  waitForReactUpdates: jest.fn().mockImplementation(() => {
    callOrder.push('waitForReactUpdates');
    return Promise.resolve();
  }),
}));

const mockExecuteGuidedStep = jest.fn();
const mockCancel = jest.fn();
const mockClearAllHighlights = jest.fn();

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: () => ({ fixNavigationRequirements: jest.fn() }),
  useSequentialStepState: () => undefined,
  GuidedHandler: jest.fn().mockImplementation(() => ({
    executeGuidedStep: mockExecuteGuidedStep,
    execute: jest.fn(),
    cancel: mockCancel,
    resetProgress: jest.fn(),
  })),
  InteractiveStateManager: jest.fn().mockImplementation(() => ({
    setState: jest.fn(),
    handleError: jest.fn(),
  })),
  NavigationManager: jest.fn().mockImplementation(() => ({
    clearAllHighlights: mockClearAllHighlights,
    highlightWithComment: jest.fn().mockResolvedValue(undefined),
    ensureNavigationOpen: jest.fn().mockResolvedValue(undefined),
    ensureElementVisible: jest.fn().mockResolvedValue(undefined),
  })),
  matchesStepAction: jest.fn().mockReturnValue(false),
}));

// ─── Mock panel-mode (full-screen -> sidebar handoff) ────────────────────────
const mockGetMode = jest.fn(() => 'sidebar');
const mockRequestSidebarHandoffAndWait = jest.fn().mockResolvedValue(undefined);
jest.mock('../../global-state/panel-mode', () => {
  const { GRAFANA_DRIVING_ACTIONS } = jest.requireActual('../../constants/interactive-actions');
  return {
    panelModeManager: { getMode: () => mockGetMode() },
    requestSidebarHandoffAndWait: (...args: unknown[]) => mockRequestSidebarHandoffAndWait(...args),
    isGrafanaDrivingHandoffNeeded: (targetAction: string) =>
      mockGetMode() === 'fullscreen' && GRAFANA_DRIVING_ACTIONS.has(targetAction),
  };
});

beforeEach(() => {
  mockStoredCompleted = false;
  mockCompletionReason = 'none';
  mockInteractiveMode = 'interactive';
  mockControllerChannel = null;
  mockPublishAppEvent.mockClear();
  jest.mocked(markStepCompleted).mockClear();
  jest.mocked(resetStep).mockClear();
  mockCheckGuidedRequirements.mockClear();
  mockExecuteGuidedStep.mockReset();
  mockMarkSkipped.mockReset();
  mockMarkSkipped.mockImplementation(() => {
    mockStoredCompleted = true;
  });
});

describe('InteractiveGuided — double skip button (issue #786)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];

    // Default: executeGuidedStep hangs (simulates waiting for user interaction)
    mockExecuteGuidedStep.mockImplementation(() => {
      callOrder.push('executeGuidedStep');
      return new Promise<never>(() => {}); // never resolves
    });
  });

  afterEach(() => {
    // Clean up any DOM nodes appended by tests
    document.querySelectorAll('.interactive-comment-skip-btn').forEach((el) => el.remove());
  });

  it('should not show the idle skip button while the guided execution is running', async () => {
    render(
      <InteractiveGuided
        stepId="test-step-1"
        skippable={true}
        internalActions={[{ targetAction: 'noop', isSkippable: true }]}
      />
    );

    // Idle state: exactly one skip button (block-level)
    expect(screen.getByTestId('interactive-skip-test-step-1')).toBeInTheDocument();

    // Click to start the guided interaction
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    // After execution starts, component must be in `executing` state
    // → idle skip button must be gone
    await waitFor(() => {
      expect(screen.queryByTestId('interactive-skip-test-step-1')).not.toBeInTheDocument();
    });
  });

  it('should call waitForReactUpdates before executeGuidedStep to prevent double skip buttons', async () => {
    render(
      <InteractiveGuided
        stepId="test-step-2"
        skippable={true}
        internalActions={[{ targetAction: 'noop', isSkippable: true }]}
      />
    );

    // Start the guided interaction
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    // Wait for executeGuidedStep to be called
    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalled();
    });

    // waitForReactUpdates must be called BEFORE executeGuidedStep to ensure
    // React commits `isExecuting: true` (hiding idle skip) before any DOM overlay appears
    const waitIdx = callOrder.indexOf('waitForReactUpdates');
    const execIdx = callOrder.indexOf('executeGuidedStep');

    expect(waitIdx).toBeGreaterThanOrEqual(0); // waitForReactUpdates was called
    expect(waitIdx).toBeLessThan(execIdx); // and it was called BEFORE executeGuidedStep
  });

  it('should have at most one skip-related button visible in idle state when both skippable levels are set', () => {
    render(
      <InteractiveGuided
        stepId="test-step-3"
        skippable={true}
        internalActions={[
          { targetAction: 'noop', isSkippable: true },
          { targetAction: 'button', refTarget: '#some-btn', isSkippable: true },
        ]}
      />
    );

    // In idle state, only the block-level skip button should be visible
    const skipButtons = screen.queryAllByTestId(/interactive-skip/);
    expect(skipButtons).toHaveLength(1);
    expect(skipButtons[0]).toHaveTextContent('Skip');
  });
});

describe('deriveGuidedUiState', () => {
  const baseState: Parameters<typeof deriveGuidedUiState>[0] = {
    isCompleted: false,
    isCompletedByObjectives: false,
    isExecuting: false,
    hasError: false,
    wasCancelled: false,
    isChecking: false,
    isEnabled: true,
  };

  it.each([
    [
      'keeps execution observable after completeEarly completion',
      { isCompleted: true, isExecuting: true },
      'executing',
    ],
    ['keeps execution observable when an error is also present', { isExecuting: true, hasError: true }, 'executing'],
    [
      'reports errors before cancellation or settled completion',
      { isCompleted: true, hasError: true, wasCancelled: true },
      'error',
    ],
    ['reports cancellation before settled completion', { isCompleted: true, wasCancelled: true }, 'cancelled'],
    [
      'reports objectives completion despite stale error and cancellation state',
      { isCompleted: true, isCompletedByObjectives: true, hasError: true, wasCancelled: true },
      'completed',
    ],
    ['reports settled completion', { isCompleted: true }, 'completed'],
    ['reports requirement checks', { isChecking: true }, 'checking'],
    ['reports idle when enabled', {}, 'idle'],
    ['reports unmet requirements when disabled', { isEnabled: false }, 'requirements-unmet'],
  ])('%s', (_name, overrides, expected) => {
    expect(deriveGuidedUiState({ ...baseState, ...overrides })).toBe(expected);
  });
});

describe('InteractiveGuided — completeEarly lifecycle', () => {
  it('does not persist completion before the final guided action starts', async () => {
    let resolveExecution: (result: string) => void = () => {};
    const onStepComplete = jest.fn();
    mockExecuteGuidedStep.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve;
        })
    );

    render(
      <InteractiveGuided
        stepId="complete-early"
        sectionId="section"
        completeEarly={true}
        onStepComplete={onStepComplete}
        internalActions={[{ targetAction: 'noop' }]}
      />
    );
    const step = screen.getByTestId(testIds.interactive.step('complete-early'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalled();
    });
    expect(step).toHaveAttribute('data-test-step-state', 'executing');
    expect(onStepComplete).not.toHaveBeenCalled();

    resolveExecution('completed');

    await waitFor(() => {
      expect(onStepComplete).toHaveBeenCalledWith('complete-early');
    });
  });

  it('persists a final click signal only after its listener starts', async () => {
    const actionOrder: string[] = [];
    mockExecuteGuidedStep.mockImplementation(async (_action, _index, _total, _timeout, onActionCompleted) => {
      actionOrder.push('listener started');
      onActionCompleted();
      return 'completed';
    });
    function AutoCollapseHarness() {
      const [isExpanded, setIsExpanded] = React.useState(true);
      return isExpanded ? (
        <InteractiveGuided
          stepId="complete-early-click"
          sectionId="section"
          completeEarly={true}
          onStepComplete={() => {
            actionOrder.push('completion persisted');
            setIsExpanded(false);
          }}
          internalActions={[{ targetAction: 'highlight', refTarget: '#install' }]}
        />
      ) : null;
    }

    render(<AutoCollapseHarness />);

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(actionOrder).toEqual(['listener started', 'completion persisted']);
      expect(screen.queryByTestId(testIds.interactive.step('complete-early-click'))).not.toBeInTheDocument();
    });
  });

  it('passes the completion callback only to the final action', async () => {
    const actionOrder: string[] = [];
    const onStepComplete = jest.fn(() => actionOrder.push('completion persisted'));
    mockExecuteGuidedStep.mockImplementation(async (_action, index, _total, _timeout, onActionCompleted) => {
      actionOrder.push(`action ${index}`);
      onActionCompleted?.();
      return 'completed';
    });

    render(
      <InteractiveGuided
        stepId="two-action-gate"
        sectionId="section"
        completeEarly={true}
        onStepComplete={onStepComplete}
        internalActions={[
          { targetAction: 'hover', refTarget: '#row' },
          { targetAction: 'highlight', refTarget: '#install' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(2);
      expect(onStepComplete).toHaveBeenCalledTimes(1);
    });
    expect(mockExecuteGuidedStep.mock.calls[0][4]).toBeUndefined();
    expect(mockExecuteGuidedStep.mock.calls[1][4]).toEqual(expect.any(Function));
    expect(actionOrder).toEqual(['action 0', 'action 1', 'completion persisted']);
  });

  it('retries completion work when its first callback attempt throws', async () => {
    const onStepComplete = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('parent persistence failed');
      })
      .mockImplementation(() => undefined);
    mockExecuteGuidedStep.mockImplementation(async (_action, _index, _total, _timeout, onActionCompleted) => {
      try {
        onActionCompleted?.();
      } catch {
        onActionCompleted?.();
      }
      return 'completed';
    });

    render(
      <InteractiveGuided
        stepId="callback-retry"
        sectionId="section"
        completeEarly={true}
        onStepComplete={onStepComplete}
        internalActions={[{ targetAction: 'highlight', refTarget: '#install' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(onStepComplete).toHaveBeenCalledTimes(2);
    });
  });
});

describe('InteractiveGuided — cancellation', () => {
  it('does not persist completeEarly completion after cancellation', async () => {
    mockExecuteGuidedStep.mockResolvedValue('cancelled');
    const onStepComplete = jest.fn();
    const onComplete = jest.fn();

    render(
      <InteractiveGuided
        stepId="cancelled-step"
        sectionId="section"
        completeEarly={true}
        onStepComplete={onStepComplete}
        onComplete={onComplete}
        internalActions={[{ targetAction: 'noop' }]}
      />
    );
    const step = screen.getByTestId(testIds.interactive.step('cancelled-step'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'cancelled');
    });
    expect(onStepComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('InteractiveGuided — failed completion', () => {
  it.each(['timeout', 'error'] as const)('does not persist completion after %s', async (result) => {
    mockExecuteGuidedStep.mockResolvedValue(result);
    const onStepComplete = jest.fn();
    const onComplete = jest.fn();
    const stepId = `failed-${result}`;

    render(
      <InteractiveGuided
        stepId={stepId}
        sectionId="section"
        completeEarly={true}
        onStepComplete={onStepComplete}
        onComplete={onComplete}
        internalActions={[{ targetAction: 'noop' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(screen.getByTestId(testIds.interactive.step(stepId))).toHaveAttribute('data-test-step-state', 'error');
    });
    expect(onStepComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('InteractiveGuided — objectives completion', () => {
  it('reports completed after objectives satisfy a step with a stale error', async () => {
    mockExecuteGuidedStep.mockResolvedValue('error');
    const props = { stepId: 'objectives-step', internalActions: [{ targetAction: 'noop' as const }] };
    const { rerender } = render(<InteractiveGuided {...props} />);
    const step = screen.getByTestId(testIds.interactive.step('objectives-step'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    mockCompletionReason = 'objectives';
    rerender(<InteractiveGuided {...props} />);

    expect(step).toHaveAttribute('data-test-step-state', 'completed');
    expect(screen.queryByTestId(testIds.interactive.errorMessage('objectives-step'))).not.toBeInTheDocument();
  });
});
describe('InteractiveGuided — completeEarly retry', () => {
  it('reruns failed actions without persisting the failed run', async () => {
    mockExecuteGuidedStep.mockResolvedValueOnce('error').mockResolvedValueOnce('completed');
    const onComplete = jest.fn();

    function RetryHarness() {
      const [, forceRender] = React.useReducer((value) => value + 1, 0);
      return (
        <InteractiveGuided
          stepId="complete-early-retry"
          completeEarly={true}
          onComplete={() => {
            onComplete();
            forceRender();
          }}
          internalActions={[{ targetAction: 'noop' }]}
        />
      );
    }

    render(<RetryHarness />);
    const step = screen.getByTestId(testIds.interactive.step('complete-early-retry'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('complete-early-retry')));

    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'completed');
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('InteractiveGuided — skip recovery', () => {
  it('clears a timeout error before reporting the step completed', async () => {
    mockExecuteGuidedStep.mockResolvedValue('timeout');

    function SkippableHarness() {
      const [, forceRender] = React.useReducer((value) => value + 1, 0);
      return (
        <InteractiveGuided
          stepId="skippable-timeout"
          skippable={true}
          onComplete={forceRender}
          internalActions={[{ targetAction: 'noop' }]}
        />
      );
    }

    render(<SkippableHarness />);
    const step = screen.getByTestId(testIds.interactive.step('skippable-timeout'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    fireEvent.click(screen.getByTestId(testIds.interactive.requirementSkipButton('skippable-timeout')));

    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'completed');
    });
    expect(screen.queryByTestId(testIds.interactive.errorMessage('skippable-timeout'))).not.toBeInTheDocument();
  });

  it('records a skipped completion for a section-managed step', async () => {
    mockExecuteGuidedStep.mockResolvedValue('timeout');

    function SectionManagedHarness() {
      const [, forceRender] = React.useReducer((value) => value + 1, 0);
      return (
        <InteractiveGuided
          stepId="section-timeout"
          sectionId="section"
          skippable={true}
          onStepComplete={() => forceRender()}
          internalActions={[{ targetAction: 'noop' }]}
        />
      );
    }

    render(<SectionManagedHarness />);
    const step = screen.getByTestId(testIds.interactive.step('section-timeout'));

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    fireEvent.click(screen.getByTestId(testIds.interactive.requirementSkipButton('section-timeout')));

    expect(mockMarkSkipped).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'completed');
    });
  });
});

describe('InteractiveGuided — AI "Fix this" gating vs sequential block', () => {
  const blockedChecker = {
    isEnabled: false,
    isChecking: false,
    explanation: 'Complete the previous step first',
    completionReason: 'none',
    requiresDomElement: true,
    canFixRequirement: false,
    markSkipped: jest.fn(),
    fixRequirement: null,
    checkStep: jest.fn(),
    isRetrying: false,
    retryCount: 0,
    maxRetries: 3,
  };

  beforeEach(() => {
    (useAiFixEnabled as jest.Mock).mockReturnValue(true);
    (useStepChecker as jest.Mock).mockReturnValue(blockedChecker);
  });

  it('hides the AI fix button when the step is not eligible (sequential "complete previous step" block)', () => {
    render(
      <InteractiveGuided
        stepId="seq-blocked"
        isEligibleForChecking={false}
        requirements="exists-reftarget"
        internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]}
      />
    );
    expect(screen.queryByTestId(testIds.interactive.guidedAiFixButton('seq-blocked'))).not.toBeInTheDocument();
  });

  it('shows the AI fix button when eligible and the element requirement fails', () => {
    render(
      <InteractiveGuided
        stepId="elig-failing"
        isEligibleForChecking={true}
        requirements="exists-reftarget"
        internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]}
      />
    );
    expect(screen.getByTestId(testIds.interactive.guidedAiFixButton('elig-failing'))).toBeInTheDocument();
  });
});

describe('InteractiveGuided — full-screen sidebar handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('sidebar');
    mockExecuteGuidedStep.mockResolvedValue('completed');
    // A prior describe block's beforeEach leaves useStepChecker mocked as
    // blocked — restore the enabled default these tests need.
    (useStepChecker as jest.Mock).mockReturnValue({
      isEnabled: true,
      isChecking: false,
      explanation: null,
      completionReason: mockCompletionReason,
      markSkipped: mockMarkSkipped,
      canFixRequirement: false,
      fixRequirement: null,
      checkStep: jest.fn(),
      isRetrying: false,
      retryCount: 0,
      maxRetries: 3,
    });
  });

  it('hands off before executing when in full screen and an internal action drives the live Grafana UI', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    render(
      <InteractiveGuided
        stepId="guided-fullscreen"
        internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]}
        fullScreenFallbackLocation="/connections"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledWith({ targetPath: '/connections' });
    });
    // The handoff must complete before the first guided step runs, not after.
    const handoffCallOrder = mockRequestSidebarHandoffAndWait.mock.invocationCallOrder[0]!;
    const execCallOrder = mockExecuteGuidedStep.mock.invocationCallOrder[0]!;
    expect(handoffCallOrder).toBeLessThan(execCallOrder);
  });

  it('does not hand off outside full screen', async () => {
    mockGetMode.mockReturnValue('sidebar');
    render(
      <InteractiveGuided stepId="guided-sidebar" internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]} />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalled();
    });
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
  });

  it('does not hand off in full screen when every internal action is a noop', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    render(<InteractiveGuided stepId="guided-noop-only" internalActions={[{ targetAction: 'noop' }]} />);

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));

    await waitFor(() => {
      expect(mockExecuteGuidedStep).toHaveBeenCalled();
    });
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
  });

  // Regression tests for a real race: the handoff wait (300-3000ms) used to
  // run before `setIsExecuting(true)`, so the button stayed clickable the
  // whole time and a second click could start a second run — or, if the
  // handoff's navigation unmounted the component mid-wait, the resumed
  // continuation would call executeGuidedStep on a dead instance.
  it('does not start a second run when clicked again while the handoff is still pending', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    let resolveHandoff!: () => void;
    mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveHandoff = resolve;
      })
    );

    render(
      <InteractiveGuided
        stepId="guided-double-click"
        internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]}
        fullScreenFallbackLocation="/connections"
      />
    );

    const startButton = screen.getByRole('button', { name: /start guided interaction/i });
    fireEvent.click(startButton);
    await waitFor(() => expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledTimes(1));

    // Second click while the first is still awaiting the handoff — the
    // synchronous isExecutingRef latch should bail this one out immediately,
    // not queue a second handoff/run.
    fireEvent.click(startButton);
    expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledTimes(1);

    resolveHandoff();
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
  });

  it('still calls executeGuidedStep after the component unmounts during the handoff wait (the handoff is expected to unmount full screen)', async () => {
    // Regression test (Cursor Bugbot, "Guided handoff aborts after dock"):
    // the handoff's own navigation unmounts this full-screen instance on
    // EVERY successful run, not just a raced one. An earlier version of this
    // fix bailed out on !isMountedRef.current here, which meant the guided
    // step never actually ran after docking — the user had to click Start
    // again in the sidebar. Simple steps and code-block Insert both continue
    // after the wait; guided steps must too.
    mockGetMode.mockReturnValue('fullscreen');
    let resolveHandoff!: () => void;
    mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveHandoff = resolve;
      })
    );

    const { unmount } = render(
      <InteractiveGuided
        stepId="guided-unmount-mid-handoff"
        internalActions={[{ targetAction: 'highlight', refTarget: '#x' }]}
        fullScreenFallbackLocation="/connections"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledTimes(1));

    unmount();
    resolveHandoff();

    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
  });
});

describe('InteractiveGuided evidence contract', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetMode.mockReturnValue('sidebar');
    (useStepChecker as jest.Mock).mockReturnValue({
      isEnabled: true,
      isChecking: false,
      completionReason: 'none',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function settleWith(statuses: GuidedSubstepStatus[]) {
    mockExecuteGuidedStep.mockImplementation(
      async (
        action: GuidedAction,
        index: number,
        _total: number,
        _timeout: number,
        onActionCompleted: (() => void) | undefined,
        options: GuidedStepOptions
      ) => {
        const status = statuses[index]!;
        options.onSettled?.({ index, action: action.targetAction, status, durationMs: 10 });
        if (status === 'completed') {
          onActionCompleted?.();
        }
        return status;
      }
    );
  }

  async function startAndAdvance(ms = 0) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  function evidence(root: HTMLElement): GuidedSubstepResult[] {
    return JSON.parse(root.getAttribute('data-test-substep-results')!);
  }
  function pendingController() {
    let finish!: (ok: boolean) => void;
    const stopProgress = jest.fn();
    const channel = {
      post: jest.fn(),
      requestRequirementCheck: jest.fn(),
      requestFix: jest.fn(),
      awaitStepComplete: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      ),
      cancelStepComplete: jest.fn(),
      onStepProgress: jest.fn(
        (
          _stepId: string,
          _runId: string,
          _callback: Parameters<NonNullable<ReturnType<typeof useControllerChannel>>['onStepProgress']>[2]
        ) => stopProgress
      ),
    };
    mockInteractiveMode = 'controller';
    mockControllerChannel = channel;
    return { channel, stopProgress, finish: (ok: boolean) => finish(ok) };
  }

  it.each([
    [undefined, 120000],
    [30000, 30000],
    [45000, 45000],
    [60000, 60000],
    [0, 120000],
    [Number.NaN, 120000],
    [Number.POSITIVE_INFINITY, 120000],
  ])('uses the same effective timeout for DOM and execution (%s)', async (authored, effective) => {
    mockExecuteGuidedStep.mockReturnValue(new Promise(() => {}));
    render(
      <InteractiveGuided
        stepId="timed"
        stepTimeout={authored}
        internalActions={[{ targetAction: 'noop', isSkippable: true }]}
      />
    );
    const root = screen.getByTestId(testIds.interactive.step('timed'));
    expect(root).toHaveAttribute('data-test-step-timeout', String(effective));
    expect(root).toHaveAttribute('data-test-substep-skippable', 'true');
    expect(evidence(root)).toEqual([]);
    await startAndAdvance();
    expect(mockExecuteGuidedStep.mock.calls[0][3]).toBe(effective);
  });

  it.each(['noop', 'button', 'highlight', 'hover', 'formfill'] as const)(
    'passes %s requirements and lazy fields through the scoped checker',
    async (targetAction) => {
      const action: GuidedAction = {
        targetAction,
        refTarget: targetAction === 'noop' ? undefined : '#target',
        targetValue: 'expected',
        requirements: ['var-accepted:true', 'section-completed:setup'],
        lazyRender: true,
        scrollContainer: '#scroll',
      };
      mockExecuteGuidedStep.mockImplementation(
        async (current, _index, _total, _timeout, _complete, options: GuidedStepOptions) => {
          await options.checkRequirements?.(current);
          return 'error';
        }
      );
      render(<InteractiveGuided stepId="scoped" internalActions={[action]} />);
      await startAndAdvance();
      expect(mockCheckGuidedRequirements).toHaveBeenCalledWith({
        requirements: action.requirements,
        targetAction,
        refTarget: action.refTarget,
        targetValue: 'expected',
        stepId: 'scoped',
        lazyRender: true,
        scrollContainer: '#scroll',
        maxRetries: 0,
      });
    }
  );

  it('publishes consecutive skips and the final action before completeEarly detaches the root', async () => {
    settleWith(['skipped', 'skipped', 'completed']);
    let completionEvidence: GuidedSubstepResult[] = [];
    let root: HTMLElement;
    function Section() {
      const [expanded, setExpanded] = React.useState(true);
      return expanded ? (
        <InteractiveGuided
          stepId="detached-evidence"
          completeEarly
          onStepComplete={() => {
            completionEvidence = evidence(root);
            flushSync(() => setExpanded(false));
          }}
          internalActions={[
            { targetAction: 'button', refTarget: '#missing-a', isSkippable: true },
            { targetAction: 'hover', refTarget: '#missing-b', isSkippable: true },
            { targetAction: 'highlight', refTarget: '#finish' },
          ]}
        />
      ) : null;
    }
    render(<Section />);
    root = screen.getByTestId(testIds.interactive.step('detached-evidence'));
    await startAndAdvance(1500);
    expect(root.isConnected).toBe(false);
    expect(completionEvidence.map((result) => result.status)).toEqual(['skipped', 'skipped', 'completed']);
    expect(evidence(root)).toEqual(completionEvidence);
  });

  it('retains prior results when a later substep fails', async () => {
    settleWith(['skipped', 'completed', 'error']);
    render(
      <InteractiveGuided
        stepId="partial-evidence"
        internalActions={[
          { targetAction: 'noop', isSkippable: true },
          { targetAction: 'formfill', refTarget: '#input' },
          { targetAction: 'button', refTarget: '#missing' },
        ]}
      />
    );
    const root = screen.getByTestId(testIds.interactive.step('partial-evidence'));
    await startAndAdvance(1000);
    expect(root).toHaveAttribute('data-test-step-state', 'error');
    expect(evidence(root).map((result) => result.status)).toEqual(['skipped', 'completed', 'error']);
  });

  it('replaces a provisional completion when its callback fails', async () => {
    mockExecuteGuidedStep.mockImplementation(
      async (action, index, _total, _timeout, complete, options: GuidedStepOptions) => {
        const result = { index, action: action.targetAction, durationMs: 10 };
        options.onSettled?.({ ...result, status: 'completed' });
        try {
          complete();
        } catch {
          options.onSettled?.({ ...result, status: 'error' });
        }
        return 'error';
      }
    );
    render(
      <InteractiveGuided
        stepId="corrected-evidence"
        completeEarly
        onStepComplete={() => {
          throw new Error('Completion failed');
        }}
        internalActions={[{ targetAction: 'highlight', refTarget: '#target' }]}
      />
    );
    const root = screen.getByTestId(testIds.interactive.step('corrected-evidence'));
    await startAndAdvance();
    expect(root).toHaveAttribute('data-test-step-state', 'error');
    expect(evidence(root)).toEqual([{ index: 0, action: 'highlight', status: 'error', durationMs: 10 }]);
  });

  it.each(['timeout', 'error', 'cancelled'] as const)(
    'clears persisted completion before a retry that ends with %s',
    async (outcome) => {
      jest.mocked(useStepChecker).mockImplementation(useRealStepChecker);
      let finishRetry!: (result: string) => void;
      let storedAtRetryStart: boolean | undefined;
      const onComplete = jest.fn(() => {
        throw new Error('Completion callback failed');
      });
      mockExecuteGuidedStep
        .mockImplementationOnce(async (_action, _index, _total, _timeout, complete) => {
          complete();
          return 'completed';
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              storedAtRetryStart = mockStoredCompleted;
              finishRetry = resolve;
            })
        );
      const props = {
        stepId: 'persisted-retry',
        completeEarly: true,
        onComplete,
        internalActions: [{ targetAction: 'noop' as const }],
      };
      const { unmount } = render(<InteractiveGuided {...props} />);
      const root = screen.getByTestId(testIds.interactive.step('persisted-retry'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(250);
      });
      await startAndAdvance();
      expect(root).toHaveAttribute('data-test-step-state', 'error');
      expect(root).toHaveAttribute('data-test-requirements-state', 'met');
      expect(mockStoredCompleted).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('persisted-retry')));
      });
      expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(2);
      expect(resetStep).toHaveBeenCalledWith('persisted-retry', undefined);
      expect(storedAtRetryStart).toBe(false);
      expect(root).toHaveAttribute('data-test-step-state', 'executing');

      await act(async () => {
        finishRetry(outcome);
      });
      expect(root).toHaveAttribute('data-test-step-state', outcome === 'cancelled' ? 'cancelled' : 'error');
      expect(mockStoredCompleted).toBe(false);
      expect(onComplete).toHaveBeenCalledTimes(1);

      unmount();
      render(<InteractiveGuided {...props} />);
      expect(screen.getByTestId(testIds.interactive.step('persisted-retry'))).toHaveAttribute(
        'data-test-step-state',
        'idle'
      );
    }
  );

  it('clears evidence on retry and ignores a late result from the prior run', async () => {
    let priorOptions: GuidedStepOptions;
    mockExecuteGuidedStep.mockImplementationOnce(
      async (_action, _index, _total, _timeout, _complete, options: GuidedStepOptions) => {
        priorOptions = options;
        options.onSettled?.({ index: 0, action: 'noop', status: 'timeout', durationMs: 30000 });
        return 'timeout';
      }
    );
    mockExecuteGuidedStep.mockImplementation(() => new Promise(() => {}));
    render(<InteractiveGuided stepId="retry-evidence" internalActions={[{ targetAction: 'noop' }]} />);
    const root = screen.getByTestId(testIds.interactive.step('retry-evidence'));
    await startAndAdvance();
    expect(evidence(root)).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('retry-evidence')));
    });
    expect(evidence(root)).toEqual([]);
    await act(async () => {
      priorOptions!.onSettled?.({ index: 0, action: 'noop', status: 'completed', durationMs: 1 });
    });
    expect(evidence(root)).toEqual([]);
  });

  it('clears evidence on reset and stops the old sequence before its next action', async () => {
    settleWith(['completed', 'completed']);
    const actions: GuidedAction[] = [{ targetAction: 'noop' }, { targetAction: 'noop' }];
    const { rerender } = render(<InteractiveGuided stepId="reset-evidence" internalActions={actions} />);
    const root = screen.getByTestId(testIds.interactive.step('reset-evidence'));
    await startAndAdvance();
    expect(evidence(root)).toHaveLength(1);
    rerender(<InteractiveGuided stepId="reset-evidence" internalActions={actions} resetTrigger={1} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(evidence(root)).toEqual([]);
    expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1);
  });

  it.each(['standalone', 'section-managed'])('preserves remote completion after a %s step unmounts', async (owner) => {
    const { channel, stopProgress, finish } = pendingController();
    const onStepComplete = owner === 'section-managed' ? jest.fn() : undefined;
    const onComplete = jest.fn();
    const sectionId = owner === 'section-managed' ? 'section' : undefined;
    const { unmount } = render(
      <InteractiveGuided
        stepId="remote-unmount"
        sectionId={sectionId}
        onStepComplete={onStepComplete}
        onComplete={onComplete}
        internalActions={[{ targetAction: 'noop' }]}
      />
    );
    const root = screen.getByTestId(testIds.interactive.step('remote-unmount'));
    await startAndAdvance();
    const progress = channel.onStepProgress.mock.calls[0]![2];
    const settled: GuidedSubstepResult[] = [{ index: 0, action: 'noop', status: 'completed', durationMs: 10 }];
    unmount();

    await act(async () => {
      progress(0, 1, settled);
      finish(true);
    });

    expect(root.isConnected).toBe(false);
    expect(evidence(root)).toEqual(settled);
    if (onStepComplete) {
      expect(onStepComplete).toHaveBeenCalledTimes(1);
      expect(onStepComplete).toHaveBeenCalledWith('remote-unmount');
      expect(markStepCompleted).not.toHaveBeenCalled();
    } else {
      expect(markStepCompleted).toHaveBeenCalledTimes(1);
      expect(markStepCompleted).toHaveBeenCalledWith('remote-unmount', undefined, 'manual');
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockPublishAppEvent).not.toHaveBeenCalled();
    expect(stopProgress).toHaveBeenCalledTimes(1);
  });

  it('ignores remote failure after unmount', async () => {
    const { stopProgress, finish } = pendingController();
    const onComplete = jest.fn();
    const { unmount } = render(
      <InteractiveGuided stepId="remote-failure" onComplete={onComplete} internalActions={[{ targetAction: 'noop' }]} />
    );
    await startAndAdvance();
    unmount();

    await act(async () => {
      finish(false);
    });

    expect(markStepCompleted).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockPublishAppEvent).not.toHaveBeenCalled();
    expect(stopProgress).toHaveBeenCalledTimes(1);
  });

  it.each(['cancellation', 'reset'])('ignores remote completion after %s', async (interruption) => {
    const { stopProgress, finish } = pendingController();
    const onComplete = jest.fn();
    const props = {
      stepId: 'remote-stale',
      onComplete,
      internalActions: [{ targetAction: 'noop' as const }],
    };
    const { rerender } = render(<InteractiveGuided {...props} />);
    await startAndAdvance();
    if (interruption === 'cancellation') {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel tour' }));
    } else {
      rerender(<InteractiveGuided {...props} resetTrigger={1} />);
    }

    await act(async () => {
      finish(true);
    });

    expect(markStepCompleted).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockPublishAppEvent).not.toHaveBeenCalled();
    expect(stopProgress).toHaveBeenCalledTimes(1);
  });

  it('retries remotely and ignores evidence from the failed remote run', async () => {
    mockInteractiveMode = 'controller';
    const channel = {
      post: jest.fn(),
      requestRequirementCheck: jest.fn(),
      requestFix: jest.fn(),
      awaitStepComplete: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockReturnValue(new Promise(() => {})),
      cancelStepComplete: jest.fn(),
      onStepProgress: jest.fn(() => jest.fn()),
    };
    mockControllerChannel = channel;
    render(<InteractiveGuided stepId="remote-retry" internalActions={[{ targetAction: 'noop' }]} />);
    const root = screen.getByTestId(testIds.interactive.step('remote-retry'));
    await startAndAdvance();
    expect(root).toHaveAttribute('data-test-step-state', 'error');
    const firstProgress = (channel.onStepProgress as jest.Mock).mock.calls[0][2];
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('remote-retry')));
    });
    expect(channel.post).toHaveBeenCalledTimes(2);
    expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
    await act(async () => {
      firstProgress(0, 1, [{ index: 0, action: 'noop', status: 'completed', durationMs: 10 }]);
    });
    expect(evidence(root)).toEqual([]);
  });

  it.each([30000, 45000, 60000, undefined])('preserves controller fields and final evidence (%s)', async (timeout) => {
    mockInteractiveMode = 'controller';
    let progress: (index: number, total: number, results?: GuidedSubstepResult[]) => void = () => {};
    let finish: (ok: boolean) => void = () => {};
    const channel = {
      post: jest.fn(),
      requestRequirementCheck: jest.fn(),
      requestFix: jest.fn(),
      awaitStepComplete: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      ),
      cancelStepComplete: jest.fn(),
      onStepProgress: jest.fn((_stepId, _runId, callback) => {
        progress = callback;
        return jest.fn();
      }),
    };
    mockControllerChannel = channel;
    const action: GuidedAction = {
      targetAction: 'formfill',
      refTarget: '#input',
      requirements: ['var-accepted:true'],
      targetValue: 'expected',
      isSkippable: true,
      lazyRender: true,
      scrollContainer: '#scroll',
      validateInput: true,
      formHint: 'Enter the expected value',
      targetComment: 'Enter a value',
    };
    let completionEvidence: GuidedSubstepResult[] = [];
    render(
      <InteractiveGuided
        stepId="remote-evidence"
        stepTimeout={timeout}
        internalActions={[action]}
        onStepComplete={() => {
          completionEvidence = evidence(root);
        }}
      />
    );
    const root = screen.getByTestId(testIds.interactive.step('remote-evidence'));
    await startAndAdvance();
    expect(channel.post).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'step-command',
        action: {
          targetAction: 'guided',
          refTarget: '',
          stepTimeout: timeout ?? 120000,
          guideId: 'guide-owner',
          contentKey: 'bundled:guide-owner',
          internalActions: [action],
        },
      })
    );
    const settled: GuidedSubstepResult[] = [{ index: 0, action: 'formfill', status: 'skipped', durationMs: 10 }];
    await act(async () => {
      progress(0, 1, settled);
      finish(true);
    });
    expect(completionEvidence).toEqual(settled);
    expect(evidence(root)).toEqual(settled);
  });
});
