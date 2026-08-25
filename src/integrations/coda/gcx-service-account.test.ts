/**
 * Minting happens in the browser because Grafana caps a *newly created* service
 * account at the caller's role. Neither the cap nor the caller's identity
 * survives account reuse, so the name and a check on what it already resolves
 * to are the whole of the guard.
 */

import { CodaError } from '@grafana/coda-client';

import { ACCOUNT_OUTRANKS_CALLER, assertServiceAccountIsMintable, gcxServiceAccountName } from './gcx-service-account';

const mockFetch = jest.fn();
const mockUser: { id?: unknown; isSignedIn?: boolean; login?: string; orgRole?: string } = {};

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }),
  config: {
    get bootData() {
      return { user: mockUser };
    },
  },
}));

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

function respondsWith(data: unknown) {
  mockFetch.mockReturnValue({
    subscribe: (observer: any) => (observer.next({ data }), observer.complete(), undefined),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockUser).forEach((key) => delete (mockUser as Record<string, unknown>)[key]);
  Object.assign(mockUser, { id: 42, isSignedIn: true, login: 'a.b', orgRole: 'Admin' });
});

describe('gcxServiceAccountName', () => {
  it('keys on the numeric user id, not the login', () => {
    expect(gcxServiceAccountName()).toBe('coda-gcx-u42');
  });

  it('separates logins the client default would collide', () => {
    const first = gcxServiceAccountName();
    Object.assign(mockUser, { id: 43, login: 'a-b' });

    // `coda-gcx-<login>` normalises both to `coda-gcx-a-b`, and reuse is by
    // exact name — so one user would mint against the other's account.
    expect(gcxServiceAccountName()).not.toBe(first);
  });

  it('refuses an anonymous visitor rather than deriving a shared name', () => {
    Object.assign(mockUser, { isSignedIn: false });
    expect(() => gcxServiceAccountName()).toThrow(/signed-in/);
  });

  it('refuses a user with no usable id', () => {
    Object.assign(mockUser, { id: 0 });
    expect(() => gcxServiceAccountName()).toThrow(/signed-in/);
  });
});

describe('assertServiceAccountIsMintable', () => {
  it('allows a name nothing holds yet', async () => {
    respondsWith({ serviceAccounts: [] });
    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('allows an account at the caller’s own role', async () => {
    Object.assign(mockUser, { orgRole: 'Editor' });
    respondsWith({ serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Editor' }] });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('refuses an account that outranks the caller today', async () => {
    // Grafana caps the role at creation and grants the creator write on the
    // account, so a demoted Admin keeps a route to an Admin token.
    Object.assign(mockUser, { orgRole: 'Editor' });
    respondsWith({ serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Admin' }] });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_OUTRANKS_CALLER,
    });
  });

  it('ignores an account whose name only partially matches', async () => {
    Object.assign(mockUser, { orgRole: 'Editor' });
    respondsWith({ serviceAccounts: [{ name: 'coda-gcx-u420', role: 'Admin' }] });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('treats a failed lookup as no answer, not a refusal', async () => {
    // Below Admin this is Grafana's own 403 on the search — the ordinary path
    // to the paste field, which the client reaches a moment later.
    mockFetch.mockReturnValue({
      subscribe: (observer: any) => (observer.error(new CodaError('no', 'role_forbidden', 403)), undefined),
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });
});
