/**
 * Minting happens in the browser because Grafana caps a *newly created* service
 * account at the caller's role. Neither the cap nor the caller's identity
 * survives account reuse, so the name and a check on what it already resolves
 * to are the whole of the guard — and a check that cannot answer has to hold
 * the mint back rather than wave it through.
 */

import { CodaError } from '@grafana/coda-client';

import {
  ACCOUNT_CHECK_UNAVAILABLE,
  ACCOUNT_OUTRANKS_CALLER,
  assertServiceAccountIsMintable,
  gcxServiceAccountName,
} from './gcx-service-account';

const mockFetch = jest.fn();
const mockUser: { id?: unknown; isSignedIn?: boolean; login?: string; orgId?: number; orgRole?: string } = {};

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

const SEARCH = '/api/serviceaccounts/search';
const ORGS = '/api/user/orgs';

type Answer = { data: unknown } | { error: unknown };

/** One answer per route, so a case can fail the search and not the role read. */
function answers(routes: Record<string, Answer>) {
  mockFetch.mockImplementation(({ url }: { url: string }) => {
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    const answer = route ? routes[route] : undefined;
    return {
      subscribe: (observer: any) => {
        if (!answer) {
          observer.error(new Error(`unstubbed route ${url}`));
        } else if ('error' in answer) {
          observer.error(answer.error);
        } else {
          observer.next({ data: answer.data });
          observer.complete();
        }
        return undefined;
      },
    };
  });
}

/** Nothing holds the name, and the caller is an Editor in their own org. */
function holdsNothing() {
  answers({ [SEARCH]: { data: { serviceAccounts: [] } }, [ORGS]: { data: [{ orgId: 1, role: 'Editor' }] } });
}

function urlsFetched(): string[] {
  return mockFetch.mock.calls.map(([request]) => request.url);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockUser).forEach((key) => delete (mockUser as Record<string, unknown>)[key]);
  Object.assign(mockUser, { id: 42, isSignedIn: true, login: 'a.b', orgId: 1, orgRole: 'Admin' });
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
    holdsNothing();
    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('does not read the caller’s role when there is no account to compare it to', async () => {
    holdsNothing();
    await assertServiceAccountIsMintable('coda-gcx-u42');

    expect(urlsFetched().some((url) => url.startsWith(ORGS))).toBe(false);
  });

  it('allows an account at the caller’s own role', async () => {
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Editor' }] } },
      [ORGS]: { data: [{ orgId: 1, role: 'Editor' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('refuses an account that outranks the caller today', async () => {
    // Grafana caps the role at creation and grants the creator write on the
    // account, so a demoted Admin keeps a route to an Admin token.
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Admin' }] } },
      [ORGS]: { data: [{ orgId: 1, role: 'Editor' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_OUTRANKS_CALLER,
    });
  });

  it('compares against the role Grafana holds now, not the one the page booted with', async () => {
    // The demotion this guard exists for happens mid-session, so `bootData`
    // still says Admin while Grafana has moved the caller to Editor.
    Object.assign(mockUser, { orgRole: 'Admin' });
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Admin' }] } },
      [ORGS]: { data: [{ orgId: 1, role: 'Editor' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_OUTRANKS_CALLER,
    });
  });

  it('reads the role for the org the caller is actually in', async () => {
    Object.assign(mockUser, { orgId: 2 });
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Admin' }] } },
      [ORGS]: {
        data: [
          { orgId: 1, role: 'Admin' },
          { orgId: 2, role: 'Viewer' },
        ],
      },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_OUTRANKS_CALLER,
    });
  });

  it('ignores an account whose name only partially matches', async () => {
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u420', role: 'Admin' }] } },
      [ORGS]: { data: [{ orgId: 1, role: 'Editor' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).resolves.toBeUndefined();
  });

  it('reports an unreadable account as a mint refusal, not as a pass', async () => {
    // Below Admin this is Grafana's own 403 on the search — the ordinary route
    // to the paste field. Reusing the name blind is what it must not become.
    answers({ [SEARCH]: { error: new CodaError('no', 'role_forbidden', 403) } });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({ code: 'mint_forbidden' });
  });

  it('holds the mint back as retryable when the lookup fails for any other reason', async () => {
    answers({ [SEARCH]: { error: { status: 503, message: 'upstream' } } });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_CHECK_UNAVAILABLE,
    });
  });

  it('holds the mint back when the caller’s role cannot be read', async () => {
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Editor' }] } },
      [ORGS]: { error: { status: 500 } },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_CHECK_UNAVAILABLE,
    });
  });

  it('holds the mint back when the caller’s org is not in the answer', async () => {
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42', role: 'Editor' }] } },
      [ORGS]: { data: [{ orgId: 99, role: 'Admin' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_CHECK_UNAVAILABLE,
    });
  });

  it('holds the mint back when the account’s own role is unreadable', async () => {
    answers({
      [SEARCH]: { data: { serviceAccounts: [{ name: 'coda-gcx-u42' }] } },
      [ORGS]: { data: [{ orgId: 1, role: 'Admin' }] },
    });

    await expect(assertServiceAccountIsMintable('coda-gcx-u42')).rejects.toMatchObject({
      code: ACCOUNT_CHECK_UNAVAILABLE,
    });
  });
});
