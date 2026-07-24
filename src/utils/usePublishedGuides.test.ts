import { renderHook, waitFor } from '@testing-library/react';

let mockNamespace: string | undefined = 'stacks-123';
jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
}));

const mockFetchCustomGuideRepository = jest.fn();
jest.mock('../lib/custom-guide-repository-client', () => ({
  fetchCustomGuideRepository: (namespace: string) => mockFetchCustomGuideRepository(namespace),
}));

import { usePublishedGuides } from './usePublishedGuides';

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
});

describe('usePublishedGuides', () => {
  it('splits published guides into paths and orphan guides', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      {
        id: 'fe-alerting-path',
        title: 'Alerting enablement',
        status: 'published',
        manifest: { type: 'path', repository: 'app-platform', milestones: ['fe-alerting-01', 'fe-alerting-02'] },
      },
      { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published', manifest: { type: 'guide' } },
      { id: 'fe-alerting-02', title: 'Alerting module 2', status: 'published' },
      { id: 'standalone-guide', title: 'A standalone guide', status: 'published' },
    ]);

    const { result } = renderHook(() => usePublishedGuides());

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.guides).toHaveLength(4);
    expect(result.current.paths.map((p) => p.id)).toEqual(['fe-alerting-path']);
    // fe-alerting-01/02 are referenced as path milestones, so they're excluded from orphans.
    expect(result.current.orphanGuides.map((g) => g.id)).toEqual(['standalone-guide']);
  });

  it('filters out unpublished (draft) guides', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      { id: 'draft-guide', title: 'Draft', status: 'draft' },
      { id: 'published-guide', title: 'Published', status: 'published' },
    ]);

    const { result } = renderHook(() => usePublishedGuides());

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.guides.map((g) => g.id)).toEqual(['published-guide']);
  });

  it('treats all guides as orphans when no path/journey manifests exist', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      { id: 'guide-a', title: 'Guide A', status: 'published' },
      { id: 'guide-b', title: 'Guide B', status: 'published', manifest: { type: 'guide' } },
    ]);

    const { result } = renderHook(() => usePublishedGuides());

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.paths).toHaveLength(0);
    expect(result.current.orphanGuides.map((g) => g.id)).toEqual(['guide-a', 'guide-b']);
  });

  it('reports an error and empty guides when no namespace is available', async () => {
    mockNamespace = undefined;

    const { result } = renderHook(() => usePublishedGuides());

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.guides).toEqual([]);
    expect(result.current.error).toBe('No namespace available');
    expect(mockFetchCustomGuideRepository).not.toHaveBeenCalled();
  });
});
