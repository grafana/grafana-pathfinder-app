const mockFetchCoreUser = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 7, orgId: 3, isSignedIn: true, orgRole: 'Viewer', isGrafanaAdmin: false } } },
}));

let mockPlatform = 'oss';
jest.mock('../lib/platform', () => ({ currentPlatform: () => mockPlatform }));

jest.mock('../lib/grafana-core-client', () => ({
  fetchCoreUser: () => mockFetchCoreUser(),
}));

import { act, renderHook } from '@testing-library/react';
import { config } from '@grafana/runtime';

import {
  currentUser,
  currentUserIsAdmin,
  currentUserIsEditor,
  ensureCurrentUser,
  isCurrentUserRoleKnown,
  refreshCurrentUser,
  resetCurrentUserForTests,
  useCurrentUserIsAdmin,
} from './current-user-role';

const setBootUser = (user: Record<string, unknown> | undefined) => {
  (config as any).bootData.user = user;
};

describe('current user', () => {
  beforeEach(() => {
    mockPlatform = 'oss';
    resetCurrentUserForTests();
    mockFetchCoreUser.mockReset();
    setBootUser({ id: 7, orgId: 3, isSignedIn: true, orgRole: 'Viewer', isGrafanaAdmin: false });
  });

  it.each([
    ['Editor', false, true, false],
    ['Admin', false, true, true],
    ['Viewer', true, true, true],
    ['Viewer', false, false, false],
  ])('boot role %s / grafanaAdmin %s → editor %s, admin %s', (orgRole, isGrafanaAdmin, editor, admin) => {
    setBootUser({ id: 1, orgRole, isGrafanaAdmin });
    expect(currentUserIsEditor()).toBe(editor);
    expect(currentUserIsAdmin()).toBe(admin);
  });

  it('reads identity from boot data before the live role resolves', () => {
    expect(currentUser()).toEqual({
      available: true,
      id: 7,
      orgId: 3,
      isSignedIn: true,
      role: 'Viewer',
      isGrafanaAdmin: false,
    });
  });

  it('prefers the live role once the proxy answers', async () => {
    mockFetchCoreUser.mockResolvedValue({ role: 'Admin', grafanaAdmin: false });
    await refreshCurrentUser();
    expect(currentUser().role).toBe('Admin');
    expect(currentUserIsAdmin()).toBe(true);
  });

  it('lets a live demotion override a stale boot role', async () => {
    setBootUser({ id: 7, orgId: 3, isSignedIn: true, orgRole: 'Admin', isGrafanaAdmin: true });
    mockFetchCoreUser.mockResolvedValue({ role: 'Viewer', grafanaAdmin: false });
    await refreshCurrentUser();
    expect(currentUserIsEditor()).toBe(false);
  });

  it('keeps boot data when the proxy cannot answer', async () => {
    mockFetchCoreUser.mockResolvedValue(undefined);
    await expect(refreshCurrentUser()).resolves.toBeUndefined();
    expect(currentUser().role).toBe('Viewer');
  });

  it('shares one in-flight read between concurrent callers', async () => {
    mockFetchCoreUser.mockResolvedValue({ role: 'Editor', grafanaAdmin: false });
    await Promise.all([refreshCurrentUser(), refreshCurrentUser()]);
    expect(mockFetchCoreUser).toHaveBeenCalledTimes(1);
  });

  it('rejects non-positive ids rather than keying storage on them', () => {
    setBootUser({ id: 0, orgId: -1, isSignedIn: false, orgRole: '' });
    expect(currentUser()).toMatchObject({ id: undefined, orgId: undefined, role: undefined });
  });

  it('reports no user when boot data has none and nothing live resolved', () => {
    setBootUser(undefined);
    expect(currentUser().available).toBe(false);
  });

  describe('on Grafana Cloud', () => {
    beforeEach(() => {
      mockPlatform = 'cloud';
      setBootUser({ id: 7, orgId: 3, isSignedIn: true, orgRole: 'Admin', isGrafanaAdmin: true });
    });

    it('never trusts the boot role', () => {
      expect(isCurrentUserRoleKnown()).toBe(false);
      expect(currentUser()).toMatchObject({ role: undefined, isGrafanaAdmin: false });
      expect(currentUserIsAdmin()).toBe(false);
    });

    it('takes the role from the live IAM answer', async () => {
      mockFetchCoreUser.mockResolvedValue({ role: 'Editor', grafanaAdmin: false });
      await ensureCurrentUser();
      expect(isCurrentUserRoleKnown()).toBe(true);
      expect(currentUserIsEditor()).toBe(true);
      expect(currentUserIsAdmin()).toBe(false);
    });

    it('retries a failed live read at most every 30 seconds', async () => {
      jest.useFakeTimers();
      try {
        mockFetchCoreUser.mockResolvedValue(undefined);
        await ensureCurrentUser();
        await ensureCurrentUser();
        expect(mockFetchCoreUser).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(30_000);
        await ensureCurrentUser();
        expect(mockFetchCoreUser).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('re-renders subscribers when the live role arrives', async () => {
      const { result } = renderHook(() => useCurrentUserIsAdmin());
      expect(result.current).toBe(false);
      mockFetchCoreUser.mockResolvedValue({ role: 'Admin', grafanaAdmin: false });
      await act(async () => {
        await refreshCurrentUser();
      });
      expect(result.current).toBe(true);
    });
  });
});
