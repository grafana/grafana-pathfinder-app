const mockFetchCustomGuideRepository = jest.fn();
jest.mock('../lib/custom-guide-repository-client', () => ({
  fetchCustomGuideRepository: (namespace: string) => mockFetchCustomGuideRepository(namespace),
}));

import { fetchAppPlatformLearningPaths } from './app-platform-paths';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchAppPlatformLearningPaths', () => {
  it('returns empty result without fetching when namespace is empty', async () => {
    const result = await fetchAppPlatformLearningPaths('');

    expect(result).toEqual({ paths: [], guideMetadata: {} });
    expect(mockFetchCustomGuideRepository).not.toHaveBeenCalled();
  });

  it('returns empty result when the catalogue has no published guides', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(result).toEqual({ paths: [], guideMetadata: {} });
  });

  it('synthesizes a LearningPath from a published path manifest', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      {
        id: 'fe-alerting-path',
        title: 'fe-alerting-path',
        status: 'published',
        manifest: {
          type: 'path',
          repository: 'app-platform',
          description: 'Alerting enablement',
          milestones: ['fe-alerting-01', 'fe-alerting-02'],
        },
      },
      { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published', manifest: { type: 'guide' } },
      { id: 'fe-alerting-02', title: 'Alerting module 2', status: 'published' },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(result.paths).toEqual([
      {
        id: 'fe-alerting-path',
        title: 'Alerting enablement',
        description: 'Alerting enablement',
        guides: ['fe-alerting-01', 'fe-alerting-02'],
        badgeId: '',
      },
    ]);
  });

  it('builds guide metadata (title + backend-guide: url) for every published entry, including path members', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      {
        id: 'fe-alerting-path',
        title: 'fe-alerting-path',
        status: 'published',
        manifest: { type: 'path', milestones: ['fe-alerting-01'] },
      },
      { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published' },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(result.guideMetadata['fe-alerting-01']).toEqual({
      title: 'Alerting module 1',
      estimatedMinutes: 5,
      url: 'backend-guide:fe-alerting-01',
    });
    expect(result.guideMetadata['fe-alerting-path']).toBeDefined();
  });

  it('excludes unpublished (draft) guides from both paths and metadata', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      { id: 'draft-guide', title: 'Draft', status: 'draft' },
      { id: 'draft-path', title: 'Draft path', status: 'draft', manifest: { type: 'path', milestones: ['x'] } },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(result.paths).toEqual([]);
    expect(result.guideMetadata['draft-guide']).toBeUndefined();
  });

  it('falls back to id when a path manifest has no description', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      {
        id: 'fe-path-no-desc',
        title: 'fe-path-no-desc',
        status: 'published',
        manifest: { type: 'journey', milestones: ['a'] },
      },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(result.paths[0]!.title).toBe('fe-path-no-desc');
    expect(result.paths[0]!.description).toBe('');
  });
});
