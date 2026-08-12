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
        title: 'Alerting enablement',
        status: 'published',
        manifest: {
          type: 'path',
          repository: 'app-platform',
          description: 'Learn to build alert rules, contact points, and notification policies.',
          milestones: ['fe-alerting-01', 'fe-alerting-02'],
        },
      },
      { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published', manifest: { type: 'guide' } },
      { id: 'fe-alerting-02', title: 'Alerting module 2', status: 'published' },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    // Card heading prefers the entry title; the description stays distinct
    // below it (rather than repeating the description as the heading).
    expect(result.paths).toEqual([
      {
        id: 'fe-alerting-path',
        title: 'Alerting enablement',
        description: 'Learn to build alert rules, contact points, and notification policies.',
        guides: ['fe-alerting-01', 'fe-alerting-02'],
        badgeId: '',
        // Carried so the My Learning launch renders members with milestone chrome.
        manifest: {
          type: 'path',
          repository: 'app-platform',
          description: 'Learn to build alert rules, contact points, and notification policies.',
          milestones: ['fe-alerting-01', 'fe-alerting-02'],
        },
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

  // Milestone ids are CR-authored. An inherited built-in name must not pass the
  // published-member gate: it would render untitled and, because it can never
  // complete, pin the path's progress denominator below 100%.
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'drops the milestone id %s, which has no published guide behind it',
    async (hostileId) => {
      mockFetchCustomGuideRepository.mockResolvedValue([
        {
          id: 'fe-alerting-path',
          title: 'Alerting enablement',
          status: 'published',
          manifest: { type: 'path', milestones: [hostileId, 'fe-alerting-01'] },
        },
        { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published' },
      ]);

      const result = await fetchAppPlatformLearningPaths('stacks-123');

      expect(result.paths[0]!.guides).toEqual(['fe-alerting-01']);
      expect(result.guideMetadata[hostileId]).toBeUndefined();
    }
  );

  it('records an entry id of __proto__ as an own metadata key instead of swapping the prototype', async () => {
    mockFetchCustomGuideRepository.mockResolvedValue([
      { id: '__proto__', title: 'Hostile', status: 'published' },
      { id: 'fe-alerting-01', title: 'Alerting module 1', status: 'published' },
    ]);

    const result = await fetchAppPlatformLearningPaths('stacks-123');

    expect(Object.hasOwn(result.guideMetadata, '__proto__')).toBe(true);
    expect(result.guideMetadata['fe-alerting-01']).toEqual({
      title: 'Alerting module 1',
      estimatedMinutes: 5,
      url: 'backend-guide:fe-alerting-01',
    });
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
