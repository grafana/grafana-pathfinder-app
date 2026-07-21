jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

let mockAvailable = true;
jest.mock('../utils/fetchBackendGuides', () => ({
  isBackendApiAvailable: () => mockAvailable,
}));

import { getBackendSrv } from '@grafana/runtime';
import { fetchCustomGuideRepository } from './custom-guide-repository-client';

const mockGet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = true;
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
});

describe('fetchCustomGuideRepository', () => {
  it('returns the guides array on success', async () => {
    mockGet.mockResolvedValue({
      namespace: 'stacks-123',
      guides: [{ id: 'fe-alerting-path', title: 'Alerting enablement', status: 'published', manifest: { type: 'path' } }],
    });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('fe-alerting-path');
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/custom-guide-repository'),
      { namespace: 'stacks-123' },
      undefined,
      { showErrorAlert: false, showSuccessAlert: false }
    );
  });

  it('returns an empty array when the backend API is unavailable, without fetching', async () => {
    mockAvailable = false;

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns an empty array when no namespace is provided', async () => {
    const result = await fetchCustomGuideRepository('');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns an empty array when the response is malformed', async () => {
    mockGet.mockResolvedValue({ namespace: 'stacks-123' });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
  });

  it('returns an empty array and swallows errors on fetch failure', async () => {
    mockGet.mockRejectedValue(new Error('network error'));

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
  });
});
