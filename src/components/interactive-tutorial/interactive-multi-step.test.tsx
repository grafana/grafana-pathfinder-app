import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { InteractiveMultiStep } from './interactive-multi-step';

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
  useAutoDetection: jest.fn(),
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
