import { of, throwError } from 'rxjs';

import { fetchBackendGuides } from './fetchBackendGuides';
import { isBackendApiAvailable } from './interactive-guides-api';
import { PLUGIN_BACKEND_URL } from '../constants';

const fetchMock = jest.fn();
jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ fetch: fetchMock }) }));
jest.mock('./interactive-guides-api', () => ({ isBackendApiAvailable: jest.fn(() => true) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isBackendApiAvailable).mockReturnValue(true);
});

it('reads full resources through the plugin proxy without sending a namespace', async () => {
  const items = [
    {
      metadata: {
        name: 'guide',
        resourceVersion: '42',
        uid: 'guide-uid',
        creationTimestamp: '2026-10-01T00:00:00Z',
        annotations: { source: 'editor' },
        labels: { team: 'observability' },
      },
      spec: { status: 'draft', blocks: [{ type: 'markdown', content: 'Hello' }] },
    },
  ];
  fetchMock.mockReturnValueOnce(of({ data: { items } }));
  await expect(fetchBackendGuides('stacks-123')).resolves.toEqual(items);
  expect(fetchMock).toHaveBeenCalledWith({
    url: `${PLUGIN_BACKEND_URL}/custom-guides`,
    method: 'GET',
    showErrorAlert: false,
  });
});

it('filters published guides and excludes drafts and guides with no status', async () => {
  const published = { spec: { status: 'published' } };
  fetchMock.mockReturnValueOnce(of({ data: { items: [published, { spec: { status: 'draft' } }, {}] } }));
  await expect(fetchBackendGuides('stacks-123', true)).resolves.toEqual([published]);
});

it.each([400, 403, 404, 405, 501, 503])('keeps optional-endpoint failures empty (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(throwError(() => ({ status })));
  await expect(fetchBackendGuides('stacks-123')).resolves.toEqual([]);
});

it.each(['status', 'statusCode', 'nested statusCode'])('handles the identity gate 403 in %s form', async (shape) => {
  const error =
    shape === 'status' ? { status: 403 } : shape === 'statusCode' ? { statusCode: 403 } : { data: { statusCode: 403 } };
  fetchMock.mockReturnValueOnce(throwError(() => error));
  await expect(fetchBackendGuides('stacks-123')).resolves.toEqual([]);
});

it.each(['oversized page', 'invalid upstream JSON', 'token exchange failure', 'upstream 401'])(
  'surfaces the proxy 502 for %s to the editor',
  async (reason) => {
    const error = { status: 502, data: { error: reason } };
    fetchMock.mockReturnValueOnce(throwError(() => error));
    await expect(fetchBackendGuides('stacks-123')).rejects.toBe(error);
  }
);

it('keeps network failures visible to the editor', async () => {
  const error = new Error('offline');
  fetchMock.mockReturnValueOnce(throwError(() => error));
  await expect(fetchBackendGuides('stacks-123')).rejects.toBe(error);
});

it('does not fetch when the backend is disabled or the namespace is missing', async () => {
  jest.mocked(isBackendApiAvailable).mockReturnValueOnce(false);
  await expect(fetchBackendGuides('stacks-123')).resolves.toEqual([]);
  await expect(fetchBackendGuides('')).resolves.toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('returns an empty array for an empty collection', async () => {
  fetchMock.mockReturnValueOnce(of({ data: { items: [] } }));
  await expect(fetchBackendGuides('stacks-123')).resolves.toEqual([]);
});
