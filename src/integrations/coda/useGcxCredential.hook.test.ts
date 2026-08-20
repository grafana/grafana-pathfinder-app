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

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: jest.fn() }),
  getGrafanaLiveSrv: () => ({}),
  config: { bootData: { user: { isSignedIn: true, login: 'admin', orgRole: 'Admin' } } },
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
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
});

describe('useGcxCredential', () => {
  it('starts idle and pending, offering to mint', () => {
    const { result } = renderHook(() => useGcxCredential());
    expect(result.current.state).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(result.current.canMint).toBe(true);
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

    // canMint is gated on `idle`, so a refused mint cannot be re-offered.
    expect(result.current.canMint).toBe(false);
  });

  it('never offers to mint when Grafana says this user cannot', () => {
    mockCanMint = false;
    const { result } = renderHook(() => useGcxCredential());
    expect(result.current.canMint).toBe(false);
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
});
