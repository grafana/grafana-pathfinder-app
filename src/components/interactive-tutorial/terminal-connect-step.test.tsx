/**
 * Tests for the TerminalConnectStep component, with and without `gcx`.
 *
 * The interesting behaviour is all in the refusal paths. Minting needs
 * `serviceaccounts:create` — Admin by default, while sandbox sessions are open
 * to Editors — so "Grafana said no" is the *ordinary* case, and it must reveal
 * the paste field rather than fail the step. Equally, the step must not tick
 * itself off merely because the terminal connected: the commands it exists to
 * enable would still fail unauthenticated.
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodaError } from '@grafana/coda-client';

import { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
import { resetGcxCredentialStore, runGcxCredential } from '../../integrations/coda/gcx-credential-store';
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
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  UserInteraction: { GcxCredentialInstalled: 'gcx_credential_installed', GcxSetupSkipped: 'gcx_setup_skipped' },
}));

jest.mock('../../lib/telemetry', () => ({ recordGcxCredentialDegradation: jest.fn() }));

const mockMarkStepCompleted = jest.fn();
jest.mock('../../global-state/completion-store', () => ({
  useStepCompletion: jest.fn(() => ({ completed: false, reason: null })),
  markStepCompleted: (...args: unknown[]) => mockMarkStepCompleted(...args),
  resetStep: jest.fn(),
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

const CREDENTIAL = {
  path: '/home/ubuntu/.config/gcx/config.yaml',
  contextName: 'coda',
  server: 'https://grafana.example.com',
};

const STEP_ID = 'step-1';

/** Pathfinder names both, so neither is the client's login-derived default. */
const mintOptions = (sessionId: string) => ({
  serviceAccountName: 'coda-gcx-u7',
  tokenName: `coda-${sessionId}`,
});

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
  mockCanMint = true;
  mockProvisionGcx.mockReset();
  mockBackendFetch.mockReset();
  preflightFindsNothing();
  // The credential state is module-scoped, shared with the terminal toolbar.
  resetGcxCredentialStore();
});

describe('without gcx', () => {
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

describe('with gcx', () => {
  it('provisions against the session id openTerminal resolved, not the rendered one', async () => {
    // Reading `sessionId` off the render can hand back the session being torn
    // down when the requested VM differs from the live one.
    connectResolves('s_resolved');
    mockSessionId = 's_stale';
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    renderStep({ gcx: true });

    fireEvent.click(screen.getByText('Try in terminal'));

    await waitFor(() => expect(mockProvisionGcx).toHaveBeenCalledWith('s_resolved', mintOptions('s_resolved')));
  });

  it('reports the file, context and server it wrote, then completes', async () => {
    connectResolves();
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));

    const ready = await screen.findByTestId(testIds.interactive.gcxReady(STEP_ID));
    expect(ready.textContent).toContain('/home/ubuntu/.config/gcx/config.yaml');
    expect(ready.textContent).toContain('coda');
    expect(ready.textContent).toContain('https://grafana.example.com');
    expect(onComplete).toHaveBeenCalled();
  });

  it('does not complete on connection alone', async () => {
    connectResolves();
    // Never settles: the credential is still in flight.
    mockProvisionGcx.mockReturnValue(new Promise(() => {}));
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));

    await waitFor(() => expect(mockProvisionGcx).toHaveBeenCalled());
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
  });

  it('reveals the paste field on mint_forbidden, without completing', async () => {
    connectResolves();
    mockProvisionGcx.mockRejectedValue(new CodaError('no', 'mint_forbidden', 403));
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));

    const error = await screen.findByTestId(testIds.interactive.gcxError(STEP_ID));
    expect(error.textContent).toMatch(/[Pp]aste/);
    expect(screen.getByTestId(testIds.interactive.gcxTokenInput(STEP_ID))).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('installs a pasted token and completes', async () => {
    connectResolves();
    mockProvisionGcx.mockRejectedValueOnce(new CodaError('no', 'mint_forbidden', 403));
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));
    await screen.findByTestId(testIds.interactive.gcxTokenInput(STEP_ID));

    mockProvisionGcx.mockResolvedValueOnce(CREDENTIAL);
    fireEvent.change(screen.getByTestId(testIds.interactive.gcxTokenInput(STEP_ID)), {
      target: { value: '  glsa_pasted  ' },
    });
    fireEvent.click(screen.getByTestId(testIds.interactive.gcxInstallButton(STEP_ID)));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(mockProvisionGcx).toHaveBeenLastCalledWith('s_abc', { token: 'glsa_pasted' });
  });

  it('will not install an empty token', async () => {
    connectResolves();
    mockProvisionGcx.mockRejectedValue(new CodaError('no', 'mint_forbidden', 403));
    renderStep({ gcx: true });

    fireEvent.click(screen.getByText('Try in terminal'));
    await screen.findByTestId(testIds.interactive.gcxTokenInput(STEP_ID));

    expect(screen.getByTestId(testIds.interactive.gcxInstallButton(STEP_ID))).toBeDisabled();
  });

  it('still offers minting when Grafana is unlikely to allow it', async () => {
    // The role check is a hint, not an authorisation answer — RBAC can grant
    // `serviceaccounts:create` without the Admin basic role.
    mockCanMint = false;
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    renderStep({ gcx: true });

    expect(screen.getByTestId(testIds.interactive.gcxMintButton(STEP_ID))).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactive.gcxTokenInput(STEP_ID))).toBeInTheDocument();
    expect(screen.getByText(/usually needs an admin/i)).toBeInTheDocument();
  });

  it('names an old Coda plugin when the route 404s on a live session', async () => {
    // The session connected moments ago, so session_not_found means the route
    // is absent, not the session. There is no capability flag to detect it.
    connectResolves();
    mockProvisionGcx.mockRejectedValue(new CodaError('Session not found', 'session_not_found', 404));
    renderStep({ gcx: true });

    fireEvent.click(screen.getByText('Try in terminal'));

    const error = await screen.findByTestId(testIds.interactive.gcxError(STEP_ID));
    expect(error.textContent).toMatch(/too old/);
    expect(error.textContent).toMatch(/1\.3\.0/);
  });

  it('uses the shared code sentence for any other backend refusal', async () => {
    connectResolves();
    mockProvisionGcx.mockRejectedValue(new CodaError('nope', 'rate_limited', 429));
    renderStep({ gcx: true });

    const error = await (fireEvent.click(screen.getByText('Try in terminal')),
    screen.findByTestId(testIds.interactive.gcxError(STEP_ID)));
    expect(error.textContent).toMatch(/Too many sandbox requests/);
  });

  it('lets the learner continue without gcx rather than dead-ending the guide', async () => {
    connectResolves();
    mockProvisionGcx.mockRejectedValue(new CodaError('no', 'mint_forbidden', 403));
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    fireEvent.click(screen.getByText('Try in terminal'));
    // Wait for the refusal to land before taking the button: the skip is
    // offered from `idle` too, and that node is replaced when the form
    // re-renders around the error.
    await screen.findByTestId(testIds.interactive.gcxError(STEP_ID));
    fireEvent.click(screen.getByTestId(testIds.interactive.gcxSkipButton(STEP_ID)));

    expect(onComplete).toHaveBeenCalled();
    expect(mockReportAppInteraction).toHaveBeenCalledWith('gcx_setup_skipped', { state: 'needs-token' });
  });

  it('does not offer Continue while the credential is still outstanding', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    renderStep({ gcx: true });

    // The plain "Continue" would tick the step off with gcx unconfigured.
    expect(screen.queryByTestId(testIds.interactive.terminalSkipButton(STEP_ID))).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactive.gcxMintButton(STEP_ID))).toBeInTheDocument();
  });

  it('asks for no credential when the sandbox never connected, and offers Connect again', async () => {
    connectResolves(null);
    renderStep({ gcx: true });

    fireEvent.click(screen.getByText('Try in terminal'));

    await waitFor(() => expect(mockOpenTerminal).toHaveBeenCalled());
    expect(mockProvisionGcx).not.toHaveBeenCalled();
    // The terminal owns the connection error; the step just stays retryable.
    expect(screen.getByText('Try in terminal')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.interactive.gcxError(STEP_ID))).not.toBeInTheDocument();
  });
});

// One store serves the guide step and the terminal toolbar, so an install made
// anywhere reaches every mounted step. Only a gcx step on the same session has
// anything to complete on it.
describe('a credential installed elsewhere', () => {
  it('leaves an ordinary connect step alone', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onComplete = jest.fn();
    renderStep({ onComplete });

    await act(async () => {
      await runGcxCredential('s_abc');
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(mockMarkStepCompleted).not.toHaveBeenCalled();
    // Nor does it borrow the other step's ready line.
    expect(screen.queryByTestId(testIds.interactive.gcxReady(STEP_ID))).not.toBeInTheDocument();
    // It still completes the way it always did.
    expect(screen.getByTestId(testIds.interactive.terminalSkipButton(STEP_ID))).toBeInTheDocument();
  });

  it('completes a gcx step waiting on the same session', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    await act(async () => {
      await runGcxCredential('s_abc');
    });

    expect(onComplete).toHaveBeenCalled();
  });

  it('leaves a gcx step targeting another VM alone', async () => {
    // A later step whose `vmTemplate` differs reconnects to its own session;
    // the credential the previous VM took is not its.
    mockTerminalStatus = 'connected';
    mockSessionId = 's_other';
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onComplete = jest.fn();
    renderStep({ gcx: true, onComplete });

    await act(async () => {
      await runGcxCredential('s_abc');
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByTestId(testIds.interactive.gcxReady(STEP_ID))).not.toBeInTheDocument();
  });
});

// Do Section never reaches this handle for a `terminal-connect` step — the
// schema's `refTarget` is 'none', so no ref is attached, and `pausesSectionRun`
// stops the run before execution (see `step-type-registry.test.ts`). These
// cover the handle for any direct caller.
describe('the executeStep handle', () => {
  it('refuses to report success while the credential is outstanding', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    mockProvisionGcx.mockReturnValue(new Promise(() => {}));
    const ref = React.createRef<{ executeStep: () => Promise<boolean> }>();
    render(<TerminalConnectStep stepId={STEP_ID} gcx ref={ref} />);

    await act(async () => {
      await expect(ref.current!.executeStep()).resolves.toBe(false);
    });
  });

  it('reports success for a connected terminal when gcx was not asked for', async () => {
    mockTerminalStatus = 'connected';
    mockSessionId = 's_abc';
    const ref = React.createRef<{ executeStep: () => Promise<boolean> }>();
    render(<TerminalConnectStep stepId={STEP_ID} ref={ref} />);

    await expect(ref.current!.executeStep()).resolves.toBe(true);
  });
});
