/**
 * The shared gcx flow, tested once here rather than twice through its two
 * consumers. `terminal-connect-step.test.tsx` still exercises it end to end
 * through the step; these cover the branches directly.
 *
 * Only the network-touching functions are stubbed — `toCodaError`,
 * `isMintForbidden` and `codaErrorCodeMessage` stay real, because the
 * classification is the behaviour under test.
 */

import { renderHook, act } from '@testing-library/react';
import { CodaError } from '@grafana/coda-client';

import { useGcxCredential } from './useGcxCredential.hook';
import { invalidateGcxCredentialForSession, resetGcxCredential } from './gcx-credential-store';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: jest.fn() }),
  getGrafanaLiveSrv: () => ({}),
  config: { bootData: { user: { isSignedIn: true, login: 'admin', orgRole: 'Admin' } } },
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

const mockReportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  UserInteraction: { GcxCredentialInstalled: 'gcx_credential_installed' },
}));

const mockRecordDegradation = jest.fn();
jest.mock('../../lib/telemetry', () => ({
  recordGcxCredentialDegradation: (...args: unknown[]) => mockRecordDegradation(...args),
}));

const mockProvisionGcx = jest.fn();
let mockCanMint = true;
jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  provisionGcx: (...args: unknown[]) => mockProvisionGcx(...args),
  canMintGrafanaToken: () => mockCanMint,
}));

const CREDENTIAL = {
  path: '/home/ubuntu/.config/gcx/config.yaml',
  contextName: 'coda',
  server: 'https://g.example.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanMint = true;
  mockProvisionGcx.mockReset();
  // The state is module-scoped so the step and the toolbar share it.
  resetGcxCredential();
});

describe('useGcxCredential', () => {
  it('starts idle and pending, offering to mint', () => {
    const { result } = renderHook(() => useGcxCredential());
    expect(result.current.state).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(result.current.offerMint).toBe(true);
    expect(result.current.mintLikely).toBe(true);
    expect(result.current.credential).toBeNull();
  });

  it('installs a minted credential and calls onReady exactly once', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onReady = jest.fn();
    const { result } = renderHook(() => useGcxCredential(onReady));

    await act(async () => {
      await result.current.run('s_abc');
    });

    expect(mockProvisionGcx).toHaveBeenCalledWith('s_abc', {});
    expect(result.current.state).toBe('ready');
    expect(result.current.isPending).toBe(false);
    expect(result.current.credential).toEqual(CREDENTIAL);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(CREDENTIAL);
  });

  it('passes a supplied token through instead of minting', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc', 'glsa_pasted');
    });

    expect(mockProvisionGcx).toHaveBeenCalledWith('s_abc', { token: 'glsa_pasted' });
  });

  it('treats mint_forbidden as a branch to the paste field, not a failure', async () => {
    mockProvisionGcx.mockRejectedValue(new CodaError('no', 'mint_forbidden', 403));
    const onReady = jest.fn();
    const { result } = renderHook(() => useGcxCredential(onReady));

    await act(async () => {
      await result.current.run('s_abc');
    });

    expect(result.current.state).toBe('needs-token');
    expect(result.current.error).toMatch(/[Pp]aste/);
    expect(result.current.isPending).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('reads a 404 on a live session as an old Coda plugin', async () => {
    // The session connected moments ago, so it exists — and there is no
    // capability flag that would let us feature-detect the route.
    mockProvisionGcx.mockRejectedValue(new CodaError('Session not found', 'session_not_found', 404));
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });

    expect(result.current.state).toBe('failed');
    expect(result.current.error).toMatch(/too old/);
    expect(result.current.error).toMatch(/1\.3\.0/);
  });

  it('uses the shared code sentence for any other refusal', async () => {
    mockProvisionGcx.mockRejectedValue(new CodaError('nope', 'rate_limited', 429));
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });

    expect(result.current.state).toBe('needs-token');
    expect(result.current.error).toMatch(/Too many sandbox requests/);
  });

  it('refuses to call the backend without a session', async () => {
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run(null);
    });

    expect(mockProvisionGcx).not.toHaveBeenCalled();
    expect(result.current.state).toBe('failed');
    expect(result.current.error).toMatch(/not connected/);
  });

  it('stops offering to mint once a run is under way', async () => {
    mockCanMint = true;
    mockProvisionGcx.mockRejectedValue(new CodaError('no', 'mint_forbidden', 403));
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });

    // `offerMint` is gated on `idle`, so a refused mint cannot be re-offered.
    expect(result.current.offerMint).toBe(false);
  });

  it('reports minting as unlikely without withdrawing the offer', () => {
    mockCanMint = false;
    const { result } = renderHook(() => useGcxCredential());
    expect(result.current.mintLikely).toBe(false);
    expect(result.current.offerMint).toBe(true);
  });

  it('reset returns it to idle', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });
    act(() => result.current.reset());

    expect(result.current.state).toBe('idle');
    expect(result.current.credential).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('records the ladder rung it stopped on, and the install it completed', async () => {
    mockProvisionGcx.mockRejectedValueOnce(new CodaError('no', 'mint_forbidden', 403));
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });
    expect(mockRecordDegradation).toHaveBeenCalledWith('mint-forbidden');

    mockProvisionGcx.mockResolvedValueOnce(CREDENTIAL);
    await act(async () => {
      await result.current.run('s_abc', 'glsa_pasted');
    });
    expect(mockReportAppInteraction).toHaveBeenCalledWith('gcx_credential_installed', { source: 'pasted' });
  });
});

describe('state shared across surfaces', () => {
  it('shows an install made on one surface to the other, without a second mint', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const step = renderHook(() => useGcxCredential(jest.fn()));
    const toolbar = renderHook(() => useGcxCredential());

    await act(async () => {
      await toolbar.result.current.run('s_abc');
    });

    // Grafana rejects a second `coda-<sessionId>` token on the name, so the
    // step must not still be offering to mint one.
    expect(step.result.current.state).toBe('ready');
    expect(step.result.current.offerMint).toBe(false);
    expect(step.result.current.credential).toEqual(CREDENTIAL);
  });

  it('completes a step whose credential was installed from the toolbar', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const onReady = jest.fn();
    renderHook(() => useGcxCredential(onReady));
    const toolbar = renderHook(() => useGcxCredential());

    await act(async () => {
      await toolbar.result.current.run('s_abc');
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(CREDENTIAL);
  });

  it('forgets a credential when the terminal moves to another session', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });
    expect(result.current.state).toBe('ready');

    // A reconnect provisions a fresh VM, which holds no credential — reporting
    // the old one as ready would name a box that no longer exists.
    act(() => invalidateGcxCredentialForSession('s_def'));
    expect(result.current.state).toBe('idle');
    expect(result.current.credential).toBeNull();
  });

  it('keeps the credential across a disconnect that may reconnect to the same session', async () => {
    mockProvisionGcx.mockResolvedValue(CREDENTIAL);
    const { result } = renderHook(() => useGcxCredential());

    await act(async () => {
      await result.current.run('s_abc');
    });

    act(() => invalidateGcxCredentialForSession(null));
    expect(result.current.state).toBe('ready');
  });

  it('declines a concurrent run rather than minting twice', async () => {
    let settle: (value: unknown) => void = () => {};
    mockProvisionGcx.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    const step = renderHook(() => useGcxCredential());
    const toolbar = renderHook(() => useGcxCredential());

    await act(async () => {
      void step.result.current.run('s_abc');
      await Promise.resolve();
    });
    await act(async () => {
      await toolbar.result.current.run('s_abc');
    });

    expect(mockProvisionGcx).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle(CREDENTIAL);
    });
  });
});
