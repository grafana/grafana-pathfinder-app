import { of, throwError } from 'rxjs';

const mockFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ fetch: mockFetch }) }));

import {
  fetchCoreDashboard,
  fetchCoreUser,
  resetCoreProxyAvailabilityForTests,
  searchCoreDashboards,
} from './grafana-core-client';

const respond = (data: unknown) => mockFetch.mockReturnValueOnce(of({ data }));
const fail = (status: number, reason?: string) =>
  mockFetch.mockReturnValueOnce(
    throwError(() => ({
      status,
      data: reason ? { error: 'x', diagnostics: { outcome: 'error', reason } } : undefined,
    }))
  );

describe('grafana core client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetCoreProxyAvailabilityForTests();
  });

  it('reads the IAM user spec through the plugin backend', async () => {
    respond({ metadata: { name: 'u1' }, spec: { role: 'Editor', grafanaAdmin: true } });
    await expect(fetchCoreUser()).resolves.toEqual({ role: 'Editor', grafanaAdmin: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/plugins/grafana-pathfinder-app/resources/grafana/user',
        method: 'GET',
        showErrorAlert: false,
      })
    );
  });

  it('accepts a flat user shape and treats a missing role as no answer', async () => {
    respond({ role: 'Viewer' });
    await expect(fetchCoreUser()).resolves.toEqual({ role: 'Viewer', grafanaAdmin: false });
    respond({ spec: {} });
    await expect(fetchCoreUser()).resolves.toBeUndefined();
  });

  it('shapes a dashboard summary and drops non-string tags', async () => {
    respond({ uid: 'd1', title: 'CPU', tags: ['a', 3], folderUid: '', folderTitle: '' });
    await expect(fetchCoreDashboard('d1')).resolves.toEqual({
      uid: 'd1',
      title: 'CPU',
      tags: ['a'],
      folderUid: undefined,
      folderTitle: undefined,
    });
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ params: { uid: 'd1' } }));
  });

  it('skips search hits without a uid', async () => {
    respond({ hits: [{ uid: 'd1', title: 'CPU', tags: [] }, { title: 'orphan' }] });
    await expect(searchCoreDashboards('cpu')).resolves.toEqual([
      { uid: 'd1', title: 'CPU', folderUid: undefined, tags: [] },
    ]);
  });

  it('answers undefined on a caller-scoped failure and keeps asking', async () => {
    fail(403, 'identity-unavailable');
    await expect(fetchCoreUser()).resolves.toBeUndefined();
    respond({ spec: { role: 'Admin' } });
    await expect(fetchCoreUser()).resolves.toEqual({ role: 'Admin', grafanaAdmin: false });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops asking for the session once the stack reports the proxy unavailable', async () => {
    fail(503, 'proxy-unavailable');
    await expect(searchCoreDashboards('cpu')).resolves.toBeUndefined();
    await expect(fetchCoreDashboard('d1')).resolves.toBeUndefined();
    await expect(fetchCoreUser()).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
