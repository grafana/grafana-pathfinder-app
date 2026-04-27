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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InteractiveGuided, resetGuidedCounter } from './interactive-guided';

// ─── Mock @grafana/ui ────────────────────────────────────────────────────────
jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

// ─── Mock @grafana/data ──────────────────────────────────────────────────────
jest.mock('@grafana/data', () => ({
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

// ─── Mock analytics (no-op) ──────────────────────────────────────────────────
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DoItButtonClick: 'do_it', StepAutoCompleted: 'auto' },
  buildInteractiveStepProperties: jest.fn(() => ({})),
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
  findButtonByText: jest.fn().mockReturnValue([]),
  querySelectorAllEnhanced: jest.fn().mockReturnValue({ elements: [], usedFallback: false }),
}));

// ─── Mock security ───────────────────────────────────────────────────────────
jest.mock('../../security', () => ({
  sanitizeDocumentationHTML: jest.fn((html: string) => html),
}));

// ─── Mock standalone persistence (no-op) ────────────────────────────────────
jest.mock('./use-standalone-persistence', () => ({
  useStandalonePersistence: jest.fn(),
}));

// ─── Mock requirements manager ───────────────────────────────────────────────
jest.mock('../../requirements-manager', () => ({
  useStepChecker: jest.fn(() => ({
    isEnabled: true,
    isChecking: false,
    explanation: null,
    completionReason: 'none',
    markSkipped: jest.fn(),
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

// ─── Mock interactive engine ──────────────────────────────────────────────────
const mockExecuteGuidedStep = jest.fn();
const mockCancel = jest.fn();
const mockClearAllHighlights = jest.fn();

jest.mock('../../interactive-engine', () => ({
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

// ─────────────────────────────────────────────────────────────────────────────

describe('InteractiveGuided — double skip button (issue #786)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];
    resetGuidedCounter();

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
