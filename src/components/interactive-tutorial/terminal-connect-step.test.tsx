import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

import { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
import { resetGcxCredentialStore } from '../../integrations/coda/gcx-credential-store';
import { testIds } from '../../constants/testIds';

jest.mock('@grafana/ui', () => ({
  Button: ({ children, onClick, disabled, tooltip, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} title={tooltip} {...rest}>
      {children}
    </button>
  ),
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
  Input: ({ onChange, value, ...rest }: any) => <input onChange={onChange} value={value} {...rest} />,
  useStyles2: () => new Proxy({}, { get: () => '' }),
}));

// `requireActual` on coda-api below pulls the real SDK in, which imports
// @grafana/runtime — and that reaches into @grafana/ui internals this suite's
// partial mock does not carry. Mocking runtime stops the chain at the edge
// rather than growing the ui mock to satisfy it.
const mockBackendFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: (...args: unknown[]) => mockBackendFetch(...args) }),
  getGrafanaLiveSrv: () => ({}),
  config: { bootData: { user: { id: 7, isSignedIn: true, login: 'admin', orgId: 1, orgRole: 'Admin' } } },
}));

/**
 * The mint preflight reads Grafana directly and fails closed, so a mint only
 * gets as far as `provisionGcx` once the account name is answered for. Nothing
 * holds it here, which is the ordinary case for a first mint.
 */
function preflightFindsNothing() {
  mockBackendFetch.mockImplementation(() => ({
    subscribe: (observer: any) => {
      observer.next({ data: { serviceAccounts: [] } });
      observer.complete();
      return undefined;
    },
  }));
}

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const mockReportAppInteraction = jest.fn();
const mockReportStepSkipped = jest.fn();
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  reportStepSkipped: (...args: unknown[]) => mockReportStepSkipped(...args),
  UserInteraction: { GcxCredentialInstalled: 'gcx_credential_installed', GcxSetupSkipped: 'gcx_setup_skipped' },
  buildInteractiveStepProperties: jest.fn((props: unknown) => props),
}));

// Mirrors `createBlockedState` / `createEnabledState`: an ineligible step is
// blocked with the sequential explanation, an eligible one is enabled. The
// override stands in for the `idle` state the real FSM starts in, before its
// post-mount effect resolves a verdict.
const mockCheckerResetStep = jest.fn();
let mockCheckerStatusOverride: string | null = null;
jest.mock('../../requirements-manager', () => ({
  useStepChecker: ({ isEligibleForChecking }: { isEligibleForChecking: boolean }) => {
    const status = mockCheckerStatusOverride ?? (isEligibleForChecking === false ? 'blocked' : 'enabled');
    return {
      status,
      isEnabled: status === 'enabled',
      isChecking: status === 'checking',
      explanation: status === 'blocked' ? 'Complete previous step' : undefined,
      resetStep: (...args: unknown[]) => mockCheckerResetStep(...args),
    };
  },
}));

jest.mock('../../lib/telemetry', () => ({ recordGcxCredentialDegradation: jest.fn() }));

const mockMarkStepCompleted = jest.fn();
const mockResetStep = jest.fn();
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: false, reason: null })),
  markStepCompleted: (...args: unknown[]) => mockMarkStepCompleted(...args),
  resetStep: (...args: unknown[]) => mockResetStep(...args),
  STANDALONE_SECTION_ID: '__standalone__',
}));

const mockOpenTerminal = jest.fn();
let mockTerminalStatus = 'disconnected';
let mockSessionId: string | null = null;
let mockIsTerminalRegistered = true;

jest.mock('../../integrations/coda/TerminalContext', () => ({
  useTerminalContext: () => ({
    status: mockTerminalStatus,
    sessionId: mockSessionId,
    openTerminal: mockOpenTerminal,
    isTerminalRegistered: mockIsTerminalRegistered,
  }),
}));

let mockSandboxUnavailable: string | null = null;
jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  useCodaTerminalGate: () => 'configured',
  useCodaSessionEligibility: () => ({ state: 'eligible' }),
  codaUnavailableMessage: () => mockSandboxUnavailable,
  useReportSandboxUnavailable: jest.fn(),
}));

// Only the two network-touching functions are stubbed. `toCodaError`,
// `isMintForbidden` and `codaErrorCodeMessage` stay real: the classification is
// the behaviour under test.
const mockProvisionGcx = jest.fn();
let mockCanMint = true;
jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
  provisionGcx: (...args: unknown[]) => mockProvisionGcx(...args),
  canMintGrafanaToken: () => mockCanMint,
}));

const STEP_ID = 'step-1';

/** Connect resolves a session id and the context reports connected, as it does live. */
function connectResolves(sessionId: string | null = 's_abc') {
  mockOpenTerminal.mockImplementation(async () => {
    mockTerminalStatus = sessionId ? 'connected' : 'error';
    mockSessionId = sessionId;
    return sessionId;
  });
}

function renderStep(props: Record<string, unknown> = {}) {
  return render(<TerminalConnectStep stepId={STEP_ID} {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetTerminalConnectStepCounter();
  mockTerminalStatus = 'disconnected';
  mockSessionId = null;
  mockIsTerminalRegistered = true;
  mockSandboxUnavailable = null;
  mockCheckerStatusOverride = null;
  mockCanMint = true;
  mockProvisionGcx.mockReset();
  mockBackendFetch.mockReset();
  preflightFindsNothing();
  // The credential state is module-scoped, shared with the terminal toolbar.
  resetGcxCredentialStore();
});

describe('without gcx', () => {
  it('exposes the connection contract and custom button control', () => {
    renderStep({ buttonText: 'Start nginx', vmTemplate: 'vm-aws-sample-app', vmApp: 'nginx' });
    const root = screen.getByTestId(testIds.interactive.terminalConnectStep(STEP_ID));
    expect(root).toHaveAttribute('data-test-terminal-status', 'disconnected');
    expect(root).toHaveAttribute('data-test-terminal-gcx', 'false');
    expect(root).toHaveAttribute('data-test-terminal-vm-requested', 'true');
    expect(screen.getByTestId(testIds.interactive.terminalConnectButton(STEP_ID))).toHaveTextContent('Start nginx');
  });

  it('exposes a failed connection without marking completion', () => {
    mockTerminalStatus = 'error';
    renderStep();
    expect(screen.getByTestId(testIds.interactive.terminalConnectStep(STEP_ID))).toHaveAttribute(
      'data-test-step-state',
      'error'
    );
    expect(screen.getByTestId(testIds.interactive.errorMessage(STEP_ID))).toHaveTextContent(
      'Terminal connection failed'
    );
    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
  });

  it('keeps shared connection errors off blocked steps and leaves announcements to the panel', () => {
    mockTerminalStatus = 'error';
    render(
      <>
        <TerminalConnectStep stepId="current" />
        <TerminalConnectStep stepId="blocked" isEligibleForChecking={false} />
      </>
    );
    expect(screen.getByTestId(testIds.interactive.terminalConnectStep('current'))).toHaveAttribute(
      'data-test-step-state',
      'error'
    );
    expect(screen.getByTestId(testIds.interactive.terminalConnectStep('blocked'))).toHaveAttribute(
      'data-test-step-state',
      'requirements-unmet'
    );
    expect(screen.queryByTestId(testIds.interactive.errorMessage('blocked'))).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactive.errorMessage('current'))).toBeVisible();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('preserves checking state during a shared connection error', () => {
    mockTerminalStatus = 'error';
    mockCheckerStatusOverride = 'checking';
    renderStep();
    expect(screen.getByTestId(testIds.interactive.terminalConnectStep(STEP_ID))).toHaveAttribute(
      'data-test-step-state',
      'checking'
    );
    expect(screen.queryByTestId(testIds.interactive.errorMessage(STEP_ID))).not.toBeInTheDocument();
  });

  it('exposes an unavailable sandbox as prerequisite evidence', () => {
    mockSandboxUnavailable = 'This account cannot create sessions.';
    renderStep();
    expect(screen.getByTestId(testIds.interactive.terminalConnectStep(STEP_ID))).toHaveAttribute(
      'data-test-terminal-unavailable',
      'true'
    );
    expect(screen.getByTestId(testIds.interactive.requirementCheck(STEP_ID))).toHaveTextContent(mockSandboxUnavailable);
    expect(screen.queryByTestId(testIds.interactive.terminalConnectButton(STEP_ID))).not.toBeInTheDocument();
  });

  it('connects and completes, never asking for a credential', async () => {
    connectResolves();
    const onComplete = jest.fn();
    renderStep({ onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(mockProvisionGcx).not.toHaveBeenCalled();
  });

  it('passes the VM options through to openTerminal', async () => {
    connectResolves();
    renderStep({ vmTemplate: 'vm-aws-sample-app', vmApp: 'nginx' });

    fireEvent.click(screen.getByText('Try in terminal'));

    await waitFor(() =>
      expect(mockOpenTerminal).toHaveBeenCalledWith({
        template: 'vm-aws-sample-app',
        app: 'nginx',
        scenario: undefined,
      })
    );
  });
});

it('opens the terminal for a previously published GCX step without provisioning a credential', async () => {
  connectResolves();
  const onComplete = jest.fn();
  renderStep({ gcx: true, onComplete });
  fireEvent.click(screen.getByText('Try in terminal'));
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  expect(mockProvisionGcx).not.toHaveBeenCalled();
  expect(screen.queryByTestId(testIds.interactive.gcxTokenInput(STEP_ID))).not.toBeInTheDocument();
});

describe('the executeStep handle', () => {
  it('reports success for a connected terminal when gcx was not asked for', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    const ref = React.createRef<{ executeStep: () => Promise<boolean> }>();
    render(<TerminalConnectStep stepId={STEP_ID} ref={ref} />);

    await expect(ref.current!.executeStep()).resolves.toBe(true);
  });
});

describe('sequential gating', () => {
  it('explains why a blocked step offers nothing instead of dead-ending silently', () => {
    renderStep({ isEligibleForChecking: false });

    expect(screen.getByText('Complete previous step')).toBeInTheDocument();
    expect(screen.queryByText('Try in terminal')).not.toBeInTheDocument();
  });

  it('offers the connect button once the prerequisite clears', () => {
    renderStep({ isEligibleForChecking: true });

    expect(screen.queryByText('Complete previous step')).not.toBeInTheDocument();
    expect(screen.getByText('Try in terminal')).toBeInTheDocument();
  });

  it('offers the connect button before the checker reports a verdict', () => {
    mockCheckerStatusOverride = 'idle';
    renderStep({ isEligibleForChecking: true });

    expect(screen.getByText('Try in terminal')).toBeInTheDocument();
  });

  it('withholds the connect button before the verdict when the prerequisite is unmet', () => {
    mockCheckerStatusOverride = 'idle';
    renderStep({ isEligibleForChecking: false });

    expect(screen.queryByText('Try in terminal')).not.toBeInTheDocument();
  });
});

describe('a section reset', () => {
  it('suppresses its own store write, since the section already wrote one', () => {
    const { rerender } = render(<TerminalConnectStep stepId={STEP_ID} onStepComplete={jest.fn()} resetTrigger={0} />);

    act(() => {
      rerender(<TerminalConnectStep stepId={STEP_ID} onStepComplete={jest.fn()} resetTrigger={1} />);
    });

    expect(mockResetStep).not.toHaveBeenCalled();
    expect(mockCheckerResetStep).toHaveBeenCalledWith({ skipStoreWrite: true });
  });

  it('writes the store itself when there is no section to own it', () => {
    const { rerender } = render(<TerminalConnectStep stepId={STEP_ID} resetTrigger={0} />);

    act(() => {
      rerender(<TerminalConnectStep stepId={STEP_ID} resetTrigger={1} />);
    });

    expect(mockResetStep).toHaveBeenCalledWith(STEP_ID, undefined);
  });
});
