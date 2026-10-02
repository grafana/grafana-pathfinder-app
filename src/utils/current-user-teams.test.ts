jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

import { getBackendSrv } from '@grafana/runtime';
import { getCurrentUserTeams, invalidateCurrentUserTeamsCache } from './current-user-teams';
import { logger } from '../lib/logging';

const mockGet = jest.fn();
const ORG_ID = 1;
const OTHER_ORG_ID = 2;

beforeEach(() => {
  jest.clearAllMocks();
  invalidateCurrentUserTeamsCache();
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
});

describe('getCurrentUserTeams', () => {
  it('returns the shaped teams array on success', async () => {
    mockGet.mockResolvedValue([
      { id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID, memberCount: 3, avatarUrl: '/avatar/x' },
    ]);

    const result = await getCurrentUserTeams(ORG_ID);

    expect(result).toEqual([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);
    expect(mockGet).toHaveBeenCalledWith('/api/user/teams');
  });

  it('returns an empty array when the user is in no teams', async () => {
    mockGet.mockResolvedValue([]);

    const result = await getCurrentUserTeams(ORG_ID);

    expect(result).toEqual([]);
  });

  it('returns an empty array when the response is malformed', async () => {
    mockGet.mockResolvedValue(null);

    const result = await getCurrentUserTeams(ORG_ID);

    expect(result).toEqual([]);
  });

  it('returns an empty array and logs a warning when the fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('network error'));

    const result = await getCurrentUserTeams(ORG_ID);

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[current-user-teams] fetch failed', { error: expect.any(Error) });
  });

  it('caches a successful result within the TTL', async () => {
    mockGet.mockResolvedValue([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);

    const first = await getCurrentUserTeams(ORG_ID);
    const second = await getCurrentUserTeams(ORG_ID);

    expect(first).toEqual(second);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent in-flight calls for the same org', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const pending = Promise.all([getCurrentUserTeams(ORG_ID), getCurrentUserTeams(ORG_ID)]);
    resolveFetch([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);
    const [a, b] = await pending;

    expect(a).toEqual(b);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure for the TTL — a retry re-fetches', async () => {
    mockGet.mockRejectedValueOnce(new Error('network error'));
    mockGet.mockResolvedValueOnce([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);

    const failed = await getCurrentUserTeams(ORG_ID);
    const retried = await getCurrentUserTeams(ORG_ID);

    expect(failed).toEqual([]);
    expect(retried).toEqual([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by orgId, so a different org always re-fetches', async () => {
    mockGet.mockResolvedValueOnce([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);
    mockGet.mockResolvedValueOnce([{ id: 2, uid: 'team-uid-2', name: 'Sellers', orgId: OTHER_ORG_ID }]);

    const forOrg1 = await getCurrentUserTeams(ORG_ID);
    const forOrg2 = await getCurrentUserTeams(OTHER_ORG_ID);

    expect(forOrg1).toEqual([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);
    expect(forOrg2).toEqual([{ id: 2, uid: 'team-uid-2', name: 'Sellers', orgId: OTHER_ORG_ID }]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after invalidateCurrentUserTeamsCache', async () => {
    mockGet.mockResolvedValue([{ id: 1, uid: 'team-uid-1', name: 'Builders', orgId: ORG_ID }]);

    await getCurrentUserTeams(ORG_ID);
    invalidateCurrentUserTeamsCache();
    await getCurrentUserTeams(ORG_ID);

    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
