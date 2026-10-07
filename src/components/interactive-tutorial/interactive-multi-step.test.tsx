import React from 'react';
import { resolveWithRetry } from '../../lib/dom/selector-retry';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { InteractiveMultiStep } from './interactive-multi-step';
import { markStepCompleted } from '../../global-state/completion-store';
import {
  clearHeldCompletionRequests,
  createCoordinatorWrapper,
  renderWithCoordinator as render,
} from '../../test-utils/completion-coordinator';

jest.mock('../../lib/dom/selector-retry', () => ({ resolveWithRetry: jest.fn() }));

jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: jest.fn() }),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DoItButtonClick: 'do_it', StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn(() => ({})),
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

jest.mock('../../lib/async-utils', () => ({
  waitForReactUpdates: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../constants/interactive-config', () => ({
  INTERACTIVE_CONFIG: {
    delays: {
      multiStep: { defaultStepDelay: 0, showToDoIterations: 0, baseInterval: 1 },
      requirements: { checkTimeout: 1000 },
    },
  },
}));

jest.mock('../../integrations/assistant-integration/use-ai-fix-enabled', () => ({
  useAiFixEnabled: jest.fn(() => false),
}));

let mockStoredCompleted = false;
let mockCompletionReason = 'none';
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
  readStepCompletion: jest.fn(async () => false),
}));

jest.mock('../../requirements-manager', () => ({
  useStepChecker: jest.fn(() => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
    completionReason: mockCompletionReason,
    markSkipped: mockMarkSkipped,
    canFixRequirement: false,
    checkStep: jest.fn(),
    isRetrying: false,
    retryCount: 0,
    maxRetries: 3,
  })),
  validateInteractiveRequirements: jest.fn(),
  getPostVerifyExplanation: (condition: string) => condition,
}));

const mockExecuteInteractiveAction = jest.fn();
const mockCheckRequirementsFromData = jest.fn().mockResolvedValue({ pass: true });
const mockStartSectionBlocking = jest.fn();
const mockStopSectionBlocking = jest.fn();
const mockClearAllHighlights = jest.fn();

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({
    executeInteractiveAction: mockExecuteInteractiveAction,
    checkRequirementsFromData: mockCheckRequirementsFromData,
    startSectionBlocking: mockStartSectionBlocking,
    stopSectionBlocking: mockStopSectionBlocking,
    isSectionBlocking: () => false,
  })),
  NavigationManager: jest.fn(() => ({ clearAllHighlights: mockClearAllHighlights })),
}));

jest.mock('../../global-state/interactive-mode-context', () => ({
  useInteractiveMode: () => 'in-tab',
}));

jest.mock('../../global-state/controller-channel', () => ({
  useControllerChannel: () => null,
}));

beforeEach(() => {
  mockStoredCompleted = false;
  mockCompletionReason = 'none';
  mockExecuteInteractiveAction.mockReset();
  mockExecuteInteractiveAction.mockResolvedValue('ok');
  mockMarkSkipped.mockReset();
  mockMarkSkipped.mockImplementation(() => {
    mockStoredCompleted = true;
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearHeldCompletionRequests();
});

function CompleteEarlyHarness({ skippable = false }: { skippable?: boolean }) {
  const [, forceRender] = React.useReducer((value) => value + 1, 0);
  return (
    <InteractiveMultiStep
      stepId="multi-step"
      completeEarly={true}
      skippable={skippable}
      onComplete={forceRender}
      internalActions={[{ targetAction: 'noop' }]}
    />
  );
}

describe('InteractiveMultiStep — completeEarly lifecycle', () => {
  it('surfaces an unsupported internal action instead of failing silently', async () => {
    render(
      <InteractiveMultiStep
        stepId="multi-unsupported"
        internalActions={[{ targetAction: 'unsupported-action' } as any]}
      />
    );

    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-unsupported')));

    await waitFor(() =>
      expect(screen.getByTestId(testIds.interactive.step('multi-unsupported'))).toHaveAttribute(
        'data-test-step-state',
        'error'
      )
    );
    expect(screen.getByTestId(testIds.interactive.errorMessage('multi-unsupported'))).toHaveTextContent(
      'Step 1 failed'
    );
    expect(screen.getByTestId(testIds.interactive.errorMessage('multi-unsupported'))).toHaveTextContent(
      'Unsupported action "unsupported-action".'
    );
    expect(mockExecuteInteractiveAction).not.toHaveBeenCalled();
  });

  it('reports executing before the early-completion delay elapses', async () => {
    jest.useFakeTimers();
    try {
      render(<CompleteEarlyHarness />);
      const step = screen.getByTestId(testIds.interactive.step('multi-step'));

      fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-step')));
      await act(async () => {
        await Promise.resolve();
      });

      expect(step).toHaveAttribute('data-test-step-state', 'executing');
      expect(mockExecuteInteractiveAction).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('reruns failed actions even though completion was persisted early', async () => {
    mockExecuteInteractiveAction
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('error')
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('ok');

    render(<CompleteEarlyHarness />);
    const step = screen.getByTestId(testIds.interactive.step('multi-step'));

    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-step')));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    fireEvent.click(screen.getByTestId(testIds.interactive.requirementRetryButton('multi-step')));

    await waitFor(() => {
      expect(mockExecuteInteractiveAction).toHaveBeenCalledTimes(4);
    });
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'completed');
    });
  });

  it('clears an execution error before skipped completion', async () => {
    mockExecuteInteractiveAction.mockResolvedValueOnce('ok').mockResolvedValueOnce('error');

    render(<CompleteEarlyHarness skippable={true} />);
    const step = screen.getByTestId(testIds.interactive.step('multi-step'));

    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-step')));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    fireEvent.click(screen.getByTestId(testIds.interactive.requirementSkipButton('multi-step')));

    expect(mockMarkSkipped).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'completed');
    });
    expect(screen.queryByTestId(testIds.interactive.errorMessage('multi-step'))).not.toBeInTheDocument();
  });
});

describe('InteractiveMultiStep — full-screen fallback location', () => {
  // Regression test (Cursor Bugbot, "Multi-step show omits handoff path"):
  // the show-phase call dropped fullScreenFallbackLocation while the do-phase
  // call right after it already threaded it through — a "Show me" click in
  // full screen would dock with no target path once isGrafanaDrivingHandoffNeeded
  // started applying to Show me too.
  it('threads fullScreenFallbackLocation into both the show-phase and do-phase calls', async () => {
    render(
      <InteractiveMultiStep
        stepId="multi-fallback"
        internalActions={[{ targetAction: 'button', refTarget: '#save' }]}
        fullScreenFallbackLocation="/connections"
      />
    );

    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-fallback')));

    await waitFor(() => expect(mockExecuteInteractiveAction).toHaveBeenCalledTimes(2));
    const [showCall, doCall] = mockExecuteInteractiveAction.mock.calls.map((call) => call[0]);
    expect(showCall).toMatchObject({ buttonType: 'show', fullScreenFallbackLocation: '/connections' });
    expect(doCall).toMatchObject({ buttonType: 'do', fullScreenFallbackLocation: '/connections' });
    await waitFor(() =>
      expect(markStepCompleted).toHaveBeenCalledWith('multi-fallback', undefined, 'manual', expect.any(String))
    );
  });
});

describe('InteractiveMultiStep — objectives completion', () => {
  it('reports completed after objectives satisfy a step with a stale error', async () => {
    mockExecuteInteractiveAction.mockResolvedValueOnce('ok').mockResolvedValueOnce('error');
    const props = { stepId: 'multi-objectives', internalActions: [{ targetAction: 'noop' as const }] };
    const { rerender } = render(<InteractiveMultiStep {...props} />);
    const step = screen.getByTestId(testIds.interactive.step('multi-objectives'));

    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('multi-objectives')));
    await waitFor(() => {
      expect(step).toHaveAttribute('data-test-step-state', 'error');
    });

    mockCompletionReason = 'objectives';
    rerender(<InteractiveMultiStep {...props} />);

    expect(step).toHaveAttribute('data-test-step-state', 'completed');
    expect(screen.queryByTestId(testIds.interactive.errorMessage('multi-objectives'))).not.toBeInTheDocument();
  });
});

describe('InteractiveMultiStep cancellation', () => {
  it.each(['discovery', 'action'])('does not report a failure when cancelled during %s', async (phase) => {
    const pending = (_target: unknown, _action: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
    if (phase === 'discovery') {
      jest.mocked(resolveWithRetry).mockImplementation(pending as any);
    } else {
      mockExecuteInteractiveAction.mockImplementation(({ buttonType, signal }) =>
        buttonType === 'show'
          ? Promise.resolve('ok')
          : new Promise((resolve) => signal.addEventListener('abort', () => resolve('error')))
      );
    }
    render(
      <InteractiveMultiStep
        stepId="cancel-pending"
        internalActions={[
          {
            targetAction: 'button',
            refTarget: '#pending',
            ...(phase === 'discovery' ? { requirements: 'exists-reftarget', lazyRender: true } : {}),
          },
        ]}
      />
    );
    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('cancel-pending')));
    await waitFor(() =>
      expect(phase === 'discovery' ? resolveWithRetry : mockExecuteInteractiveAction).toHaveBeenCalled()
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await waitFor(() =>
      expect(screen.getByTestId(testIds.interactive.step('cancel-pending'))).not.toHaveAttribute(
        'data-test-step-state',
        'executing'
      )
    );
    expect(screen.getByTestId(testIds.interactive.step('cancel-pending'))).not.toHaveAttribute(
      'data-test-step-state',
      'error'
    );
    expect(mockStoredCompleted).toBe(false);
  });
});

describe('InteractiveMultiStep — under the completion coordinator', () => {
  it('persists completeEarly before the first action runs', async () => {
    const order: string[] = [];
    mockExecuteInteractiveAction.mockImplementation(async () => {
      order.push('action');
      return 'ok';
    });
    render(
      <InteractiveMultiStep
        stepId="managed-early"
        sectionId="section"
        completeEarly={true}
        onStepComplete={() => order.push('completed')}
        internalActions={[{ targetAction: 'highlight', refTarget: '#a' }]}
      />
    );
    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('managed-early')));
    await waitFor(() => expect(order).toContain('action'));
    expect(order[0]).toBe('completed');
  });

  it('persists a run that finishes after its host unmounted', async () => {
    const onStepComplete = jest.fn();
    let unmount = () => {};
    mockExecuteInteractiveAction.mockImplementation(async () => {
      unmount();
      return 'ok';
    });
    const view = render(
      <InteractiveMultiStep
        stepId="managed-handoff"
        sectionId="section"
        onStepComplete={onStepComplete}
        internalActions={[{ targetAction: 'highlight', refTarget: '#a' }]}
      />
    );
    unmount = () => view.unmount();
    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('managed-handoff')));
    await waitFor(() => expect(onStepComplete).toHaveBeenCalledTimes(1));
  });

  it('reports waiting while an objective gates a finished run', async () => {
    let satisfied = false;
    const onComplete = jest.fn();
    render(
      <InteractiveMultiStep
        stepId="managed-gated"
        objectives={['has-datasources']}
        onComplete={onComplete}
        internalActions={[{ targetAction: 'highlight', refTarget: '#a' }]}
      />,
      { wrapper: createCoordinatorWrapper(async () => satisfied) }
    );
    fireEvent.click(screen.getByTestId(testIds.interactive.doItButton('managed-gated')));

    const step = screen.getByTestId(testIds.interactive.step('managed-gated'));
    await waitFor(() => expect(step).toHaveAttribute('data-test-step-state', 'waiting'));
    expect(onComplete).not.toHaveBeenCalled();

    satisfied = true;
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.interactive.checkCompletionButton('managed-gated')));
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
