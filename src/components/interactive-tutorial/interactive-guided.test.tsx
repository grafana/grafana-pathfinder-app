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
import { waitForReactUpdates } from '../../lib/async-utils';
import { GuidedHandler as RealGuidedHandler } from '../../interactive-engine/action-handlers/guided-handler';
import { querySelectorAllEnhanced } from '../../lib/dom';
import { acquireGuidedRun } from '../../global-state/guided-run';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { deriveGuidedUiState, InteractiveGuided } from './interactive-guided';
import { useStepChecker } from '../../requirements-manager';
import { useAiFixEnabled } from '../../integrations/assistant-integration/use-ai-fix-enabled';
import { testIds } from '../../constants/testIds';

const mockInteractiveMode = jest.fn(() => 'interactive');
const mockControllerChannel = jest.fn();
jest.mock('../../global-state/interactive-mode-context', () => ({
  useInteractiveMode: () => mockInteractiveMode(),
}));
jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: () => mockControllerChannel(),
}));

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
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  usePathfinderPluginConfig: () => ({ config: {}, isResolved: true }),
}));

jest.mock('@grafana/data', () => ({
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

// ─── Mock @grafana/runtime ───────────────────────────────────────────────────
// The component publishes app-event toasts via getAppEvents(); importing the
// real module pulls in config/LocationService, which needs @grafana/data's
// getThemeById (not provided by the mock above).
const mockPublish = jest.fn();
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: (_name: string, _attrs: unknown, work: () => unknown) => work(),
}));
jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: mockPublish }),
}));

// ─── Mock useAiFixEnabled (off) — avoids pulling @grafana/assistant, which this
//     suite's @grafana/ui mock would otherwise leave un-themed and crashing ─────
jest.mock('../../integrations/assistant-integration/use-ai-fix-enabled', () => ({
  useAiFixEnabled: jest.fn(() => false),
}));

// ─── Mock analytics (no-op) ──────────────────────────────────────────────────
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  createInteractionName: (name: string) => name,
  UserInteraction: { DoItButtonClick: 'do_it', StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn(() => ({})),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

// ─── Mock constants ──────────────────────────────────────────────────────────
jest.mock('../../constants', () => ({
  getConfigWithDefaults: jest.fn(() => ({})),
}));
jest.mock('../../constants/interactive-config', () => ({
  getInteractiveConfig: jest.fn(() => ({
    autoDetection: { enabled: false },
    guided: { stepTimeout: 120000, hoverDwell: 500 },
    delays: {},
  })),
  INTERACTIVE_CONFIG: { guided: { stepTimeout: 120000 } },
}));

// ─── Mock DOM utils ──────────────────────────────────────────────────────────
jest.mock('../../lib/dom', () => ({
  resolveSelector: (selector: string) => selector,
  isElementVisible: () => true,
  describeElement: () => 'button',
  findButtonByText: jest.fn().mockReturnValue([]),
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false }),
}));

// ─── Mock security ───────────────────────────────────────────────────────────
jest.mock('../../security', () => ({
  sanitizeDocumentationHTML: jest.fn((html: string) => html),
}));

const mockActionRequirements = jest.fn().mockResolvedValue({ pass: true });
const mockDispatchFix = jest.fn().mockResolvedValue({ ok: true });
let mockStoredCompleted = false;
let mockCompletionReason = 'none';
const mockMarkSkipped = jest.fn(() => {
  mockStoredCompleted = true;
});

// ─── Mock completion store ────────────────────────────────────────────────
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: mockStoredCompleted, reason: null })),
  markStepCompleted: jest.fn(() => {
    mockStoredCompleted = true;
  }),
  resetStep: jest.fn(),
  STANDALONE_SECTION_ID: '__standalone__',
}));

// ─── Mock requirements manager ───────────────────────────────────────────────
jest.mock('../../requirements-manager', () => ({
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
  useGuideRequirements: () => ({ checkRequirements: mockActionRequirements }),
  dispatchFix: (...args: unknown[]) => mockDispatchFix(...args),
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

// ─── Mock interactive engine ──────────────────────────────────────────────────
const mockExecuteGuidedStep = jest.fn();
const mockCancel = jest.fn();
const mockClearAllHighlights = jest.fn();

jest.mock('../../interactive-engine', () => ({
  GuidedHandler: jest.fn().mockImplementation(() => ({
    executeGuidedStep: mockExecuteGuidedStep,
    execute: jest.fn(),
    cancel: mockCancel,
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

// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockInteractiveMode.mockReturnValue('interactive');
  mockControllerChannel.mockReturnValue(null);
  mockActionRequirements.mockReset().mockResolvedValue({ pass: true });
  mockDispatchFix.mockClear();
  mockPublish.mockClear();
  mockStoredCompleted = false;
  mockCompletionReason = 'none';
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
  it('honours a requirement fix after the handler has prepared its target', async () => {
    mockActionRequirements
      .mockResolvedValueOnce({ pass: false, error: [{ canFix: true, fixType: 'navigation' }] })
      .mockResolvedValueOnce({ pass: true });
    mockExecuteGuidedStep.mockImplementation(async (_action, _index, _count, _timeout, _complete, options) => {
      expect(mockActionRequirements).not.toHaveBeenCalled();
      return (await options.revalidate()) ? 'completed' : 'error';
    });
    render(
      <InteractiveGuided
        stepId="fix-after-target"
        internalActions={[{ targetAction: 'highlight', refTarget: '#target', requirements: 'navmenu-open' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockStoredCompleted).toBe(true));
    expect(mockDispatchFix).toHaveBeenCalledWith(
      expect.objectContaining({ fixType: 'navigation', requirements: 'navmenu-open' })
    );
    expect(mockActionRequirements).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    'persists a padding-click completion after host unmount (standalone: %s)',
    async (standalone) => {
      const target = document.createElement('button');
      target.id = 'padding-target';
      document.body.append(target);
      jest
        .mocked(querySelectorAllEnhanced)
        .mockReturnValue({ elements: [target], usedFallback: false, originalSelector: '#padding-target' });
      jest
        .spyOn(target, 'getBoundingClientRect')
        .mockReturnValue({ left: 100, right: 200, top: 100, bottom: 140, width: 100, height: 40 } as DOMRect);
      const navigation = {
        ensureNavigationOpen: jest.fn(),
        ensureElementVisible: jest.fn(),
        expandParentNavigationSection: jest.fn(),
        clearOwnedHighlights: jest.fn(),
        highlightWithComment: jest.fn(),
        showNoopComment: jest.fn(),
      };
      const realHandler = new RealGuidedHandler({} as any, navigation as any, async () => {});
      mockExecuteGuidedStep.mockImplementation(realHandler.executeGuidedStep.bind(realHandler));
      const onComplete = jest.fn();
      const onStepComplete = jest.fn();
      const view = render(
        <InteractiveGuided
          stepId="padding-complete"
          onComplete={onComplete}
          onStepComplete={standalone ? undefined : onStepComplete}
          internalActions={[{ targetAction: 'highlight', refTarget: '#padding-target' }]}
        />
      );
      target.onclick = () => view.unmount();
      try {
        fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
        await waitFor(() => expect(navigation.highlightWithComment).toHaveBeenCalled());
        await act(async () => {
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 95, clientY: 110 }));
        });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        if (standalone) {
          expect(mockStoredCompleted).toBe(true);
        } else {
          expect(onStepComplete).toHaveBeenCalledTimes(1);
        }
      } finally {
        realHandler.cancel();
        target.remove();
        jest
          .mocked(querySelectorAllEnhanced)
          .mockReturnValue({ elements: [], usedFallback: false, originalSelector: '' });
      }
    }
  );

  it('returns to idle after reset while an aborted handler settles', async () => {
    let finish!: (result: string) => void;
    mockExecuteGuidedStep.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const props = { stepId: 'reset-active', internalActions: [{ targetAction: 'noop' as const }] };
    const { rerender } = render(<InteractiveGuided {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalled());
    rerender(<InteractiveGuided {...props} resetTrigger={1} />);
    await act(async () => {
      finish('cancelled');
    });
    expect(screen.getByTestId(testIds.interactive.step('reset-active'))).toHaveAttribute(
      'data-test-step-state',
      'idle'
    );
    expect(mockStoredCompleted).toBe(false);
  });

  it('persists the final successful action without a cosmetic delay', async () => {
    let finish!: (result: string) => void;
    mockExecuteGuidedStep.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const onComplete = jest.fn();
    const { unmount } = render(
      <InteractiveGuided stepId="final-action" onComplete={onComplete} internalActions={[{ targetAction: 'noop' }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalled());
    await act(async () => {
      finish('completed');
    });
    unmount();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockStoredCompleted).toBe(true);
  });

  it('retains retry state when another guided interaction holds the lease', async () => {
    mockExecuteGuidedStep.mockResolvedValue('error');
    render(<InteractiveGuided stepId="lease-retry" internalActions={[{ targetAction: 'noop' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    const step = screen.getByTestId(testIds.interactive.step('lease-retry'));
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'error'));
    const otherRun = acquireGuidedRun();
    expect(otherRun).not.toBeNull();
    try {
      fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('lease-retry')));
      await act(async () => {});
      expect(step).toHaveAttribute('data-test-step-state', 'error');
      expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1);
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'alert-info',
          payload: expect.arrayContaining(['Another guided interaction is in progress']),
        })
      );
    } finally {
      otherRun?.release();
    }
  });

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
describe('InteractiveGuided — current action recovery', () => {
  it.each(['error', 'timeout'] as const)(
    'retries a %s action without replaying completed predecessors',
    async (failure) => {
      mockExecuteGuidedStep
        .mockResolvedValueOnce('completed')
        .mockResolvedValueOnce(failure)
        .mockResolvedValueOnce('completed');
      render(
        <InteractiveGuided
          stepId="resume-current"
          internalActions={[
            { targetAction: 'noop', targetComment: 'First' },
            { targetAction: 'noop', targetComment: 'Second' },
          ]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
      await waitFor(() =>
        expect(screen.getByTestId(testIds.interactive.step('resume-current'))).toHaveAttribute(
          'data-test-step-state',
          'error'
        )
      );
      fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('resume-current')));
      await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(3));
      expect(mockExecuteGuidedStep.mock.calls.map((call) => call[1])).toEqual([0, 1, 1]);
    }
  );
  it('seeds controller retry progress before the live tab sends progress', async () => {
    mockInteractiveMode.mockReturnValue('controller');
    let progress!: (index: number) => void;
    let finish!: (ok: boolean) => void;
    const channel = {
      post: jest.fn(),
      onStepProgress: jest.fn((_step, _run, callback) => {
        progress = callback;
        return jest.fn();
      }),
      awaitStepComplete: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      ),
    };
    mockControllerChannel.mockReturnValue(channel);
    const { container } = render(
      <InteractiveGuided
        stepId="remote-retry"
        internalActions={[
          { targetAction: 'button', refTarget: '#one', targetComment: 'First instruction' },
          { targetAction: 'button', refTarget: '#two', targetComment: 'Second instruction' },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    act(() => progress(1));
    await act(async () => finish(false));
    fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('remote-retry')));
    expect(channel.post).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'step-command', startIndex: 1 }));
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Second instruction')).toBeInTheDocument();
    expect(container.querySelector('.interactive-guided-progress-fill')).toHaveStyle({ width: '50%' });
    expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
    await act(async () => finish(true));
    expect(screen.getByTestId(testIds.interactive.step('remote-retry'))).toHaveAttribute(
      'data-test-step-state',
      'completed'
    );
  });

  it('keeps the failed substep visible while retry waits for the execution render', async () => {
    mockExecuteGuidedStep
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('completed');
    const { container } = render(
      <InteractiveGuided
        stepId="retry-visible"
        internalActions={[
          { targetAction: 'noop', targetComment: 'First instruction' },
          { targetAction: 'noop', targetComment: 'Second instruction' },
        ]}
      />
    );
    const step = screen.getByTestId(testIds.interactive.step('retry-visible'));
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'error'));
    let finishRender!: () => void;
    jest.mocked(waitForReactUpdates).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRender = resolve;
        })
    );
    fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('retry-visible')));
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'executing'));
    expect(step).toHaveAttribute('data-test-substep-index', '1');
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Second instruction')).toBeInTheDocument();
    expect(container.querySelector('.interactive-guided-progress-fill')).toHaveStyle({ width: '50%' });
    expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(2);
    await act(async () => finishRender());
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'completed'));
    expect(mockExecuteGuidedStep.mock.calls.map((call) => call[1])).toEqual([0, 1, 1]);
  });

  it('restarts from step zero after cancellation', async () => {
    mockExecuteGuidedStep
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('cancelled')
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('cancelled');
    render(
      <InteractiveGuided
        stepId="cancel-restart"
        internalActions={[
          { targetAction: 'noop', targetComment: 'First' },
          { targetAction: 'noop', targetComment: 'Second' },
        ]}
      />
    );
    const step = screen.getByTestId(testIds.interactive.step('cancel-restart'));
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'cancelled'));
    fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('cancel-restart')));
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(4));
    expect(mockExecuteGuidedStep.mock.calls.map((call) => call[1])).toEqual([0, 1, 0, 1]);
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

  it('waits for the sidebar successor after the full-screen host unmounts', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    let resolveHandoff!: () => void;
    mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveHandoff = resolve;
      })
    );
    const props = {
      stepId: 'guided-unmount-mid-handoff',
      internalActions: [{ targetAction: 'highlight' as const, refTarget: '#x' }],
    };
    const fullscreen = render(<InteractiveGuided {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    fullscreen.unmount();
    await act(async () => {
      resolveHandoff();
    });
    expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
    mockGetMode.mockReturnValue('sidebar');
    render(<InteractiveGuided {...props} />);
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
  });
});

describe('InteractiveGuided — successor ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('sidebar');
    mockRequestSidebarHandoffAndWait.mockResolvedValue(undefined);
    (useStepChecker as jest.Mock).mockReturnValue({ isEnabled: true, isChecking: false, completionReason: 'none' });
    window.__DocsPluginActiveTabUrl = 'bundled:successor-test';
  });

  afterEach(() => {
    delete window.__DocsPluginActiveTabUrl;
    window.history.replaceState(null, '', '/');
  });

  it.each(['cancel', 'close', 'reset'])('transfers full-screen cancellation to the sidebar: %s', async (action) => {
    mockGetMode.mockReturnValue('fullscreen');
    let finishHandoff!: () => void;
    let signal!: AbortSignal;
    let finishStep!: (result: string) => void;
    mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishHandoff = resolve;
      })
    );
    mockExecuteGuidedStep.mockImplementation((_a, _i, _n, _t, _c, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finishStep = resolve;
        signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
      });
    });
    const props = {
      stepId: 'transferred',
      internalActions: [{ targetAction: 'highlight' as const, refTarget: '#target' }],
    };
    const fullscreen = render(<InteractiveGuided {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    fullscreen.unmount();
    mockGetMode.mockReturnValue('sidebar');
    const sidebar = render(<InteractiveGuided {...props} />);
    await act(async () => {
      finishHandoff();
    });
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /start guided interaction/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel tour/i })).toBeVisible();
    await act(async () => {
      if (action === 'close') {
        sidebar.unmount();
      } else if (action === 'reset') {
        sidebar.rerender(<InteractiveGuided {...props} resetTrigger={1} />);
      } else {
        fireEvent.click(screen.getByRole('button', { name: /cancel tour/i }));
      }
    });
    const abortedOnDismiss = signal.aborted;
    await act(async () => {
      finishStep('cancelled');
    });
    expect(abortedOnDismiss).toBe(true);
    const next = acquireGuidedRun();
    expect(next).not.toBeNull();
    next?.release();
    expect(mockStoredCompleted).toBe(false);
  });

  it('continues after an intermediate navigation and lets the replacement cancel the next step', async () => {
    let finishFirst!: (result: string) => void;
    let signal!: AbortSignal;
    mockExecuteGuidedStep
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce((_a, _i, _n, _t, _c, options) => {
        signal = options.signal;
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
      });
    const props = {
      stepId: 'navigation-successor',
      internalActions: [
        { targetAction: 'highlight' as const, refTarget: 'a[href="/dashboards"]' },
        { targetAction: 'noop' as const, targetComment: 'Second step' },
      ],
    };
    const original = render(<InteractiveGuided {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.history.pushState(null, '', '/dashboards');
      original.unmount();
      finishFirst('completed');
    });
    const successor = render(<InteractiveGuided {...props} />);
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Step 2 of 2')).toBeVisible();
    await act(async () => {
      successor.unmount();
    });
    expect(signal.aborted).toBe(true);
    const next = acquireGuidedRun();
    expect(next).not.toBeNull();
    next?.release();
    expect(mockStoredCompleted).toBe(false);
  });

  it('uses the successor completion callback after navigation', async () => {
    let finishFirst!: (result: string) => void;
    mockExecuteGuidedStep
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValueOnce('completed');
    const props = {
      stepId: 'callback-successor',
      internalActions: [{ targetAction: 'noop' as const }, { targetAction: 'noop' as const }],
    };
    const previousComplete = jest.fn();
    const nextComplete = jest.fn();
    const original = render(<InteractiveGuided {...props} onComplete={previousComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    await waitFor(() => expect(mockExecuteGuidedStep).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.history.pushState(null, '', '/dashboards');
      original.unmount();
      finishFirst('completed');
    });
    render(<InteractiveGuided {...props} onComplete={nextComplete} />);
    await waitFor(() => expect(nextComplete).toHaveBeenCalledTimes(1));
    expect(previousComplete).not.toHaveBeenCalled();
    expect(mockStoredCompleted).toBe(true);
  });
  it('cancels when the sidebar closes before the handoff wait finishes', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    let finishHandoff!: () => void;
    mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishHandoff = resolve;
      })
    );
    const props = {
      stepId: 'pending-handoff',
      internalActions: [{ targetAction: 'highlight' as const, refTarget: '#missing' }],
    };
    const original = render(<InteractiveGuided {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
    original.unmount();
    mockGetMode.mockReturnValue('sidebar');
    const successor = render(<InteractiveGuided {...props} />);
    successor.unmount();
    await act(async () => {
      finishHandoff();
    });
    expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
    const next = acquireGuidedRun();
    expect(next).not.toBeNull();
    next?.release();
  });

  it('expires an unclaimed handoff without starting an invisible action', async () => {
    jest.useFakeTimers();
    try {
      mockGetMode.mockReturnValue('fullscreen');
      let finishHandoff!: () => void;
      mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishHandoff = resolve;
        })
      );
      const original = render(
        <InteractiveGuided
          stepId="missing-successor"
          internalActions={[{ targetAction: 'highlight', refTarget: '#missing' }]}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
      original.unmount();
      await act(async () => {
        finishHandoff();
      });
      expect(acquireGuidedRun()).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
      const next = acquireGuidedRun();
      expect(next).not.toBeNull();
      next?.release();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not adopt a run from a different guide with matching step IDs', async () => {
    jest.useFakeTimers();
    try {
      mockGetMode.mockReturnValue('fullscreen');
      let finishHandoff!: () => void;
      mockRequestSidebarHandoffAndWait.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishHandoff = resolve;
        })
      );
      const props = {
        stepId: 'shared-step-id',
        internalActions: [{ targetAction: 'highlight' as const, refTarget: '#missing' }],
      };
      const original = render(<InteractiveGuided {...props} />);
      fireEvent.click(screen.getByRole('button', { name: /start guided interaction/i }));
      original.unmount();
      window.__DocsPluginActiveTabUrl = 'bundled:different-guide';
      mockGetMode.mockReturnValue('sidebar');
      render(<InteractiveGuided {...props} />);
      expect(screen.getByRole('button', { name: /start guided interaction/i })).toBeVisible();
      await act(async () => {
        finishHandoff();
        jest.advanceTimersByTime(3000);
      });
      expect(mockExecuteGuidedStep).not.toHaveBeenCalled();
      const next = acquireGuidedRun();
      expect(next).not.toBeNull();
      next?.release();
    } finally {
      jest.useRealTimers();
    }
  });
});
