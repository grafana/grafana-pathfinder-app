import type { LearningJourneyTab, PackageOpenInfo, PendingAlignment } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import { buildDocsLoadSuccessPatch, resolveDocsLoadAlignment } from './docs-load-finalizer';

function tab(overrides: Partial<LearningJourneyTab> = {}): LearningJourneyTab {
  return {
    id: 'guide-1',
    type: 'docs',
    title: 'Guide one',
    baseUrl: 'bundled:launch/content.json',
    currentUrl: 'bundled:launch/content.json',
    content: null,
    isLoading: true,
    error: null,
    ...overrides,
  };
}

function content(overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: '{"id":"guide-1","title":"Guide one","blocks":[]}',
    type: 'interactive',
    url: 'bundled:fetched/content.json',
    lastFetched: '2026-08-27T00:00:00.000Z',
    metadata: { title: 'Guide one' },
    ...overrides,
  };
}

const alignmentInput = {
  requestedUrl: 'backend-guide:guide-1',
  currentPath: '/explore',
  launchSource: 'home_page' as const,
  isAdmin: false,
  isFullScreen: false,
};

describe('resolveDocsLoadAlignment', () => {
  it('prefers the explicit package manifest over the fetched manifest', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        packageManifest: { startingLocation: '/connections' },
        fetchedManifest: { startingLocation: '/alerting' },
      })
    ).toEqual({ startingLocation: '/connections', currentPath: '/explore', launchSource: 'home_page' });
  });

  it('falls back to the fetched manifest', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        packageManifest: { id: 'guide-1' },
        fetchedManifest: { startingLocation: '/alerting' },
      })
    ).toEqual({ startingLocation: '/alerting', currentPath: '/explore', launchSource: 'home_page' });
  });

  it.each(['/connections', '/connections/data-sources'])(
    'suppresses a prompt when current path %s satisfies the starting location',
    (currentPath) => {
      expect(
        resolveDocsLoadAlignment({
          ...alignmentInput,
          currentPath,
          packageManifest: { startingLocation: '/connections' },
        })
      ).toBeUndefined();
    }
  );

  it.each(['recommender', 'browser_restore', 'internal_reload'] as const)(
    'suppresses a prompt for the aligned-by-construction source %s',
    (launchSource) => {
      expect(
        resolveDocsLoadAlignment({
          ...alignmentInput,
          launchSource,
          packageManifest: { startingLocation: '/connections' },
        })
      ).toBeUndefined();
    }
  );

  it('returns the exact decision for a mismatched needs-check source', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        launchSource: 'custom_guide',
        packageManifest: { startingLocation: '/connections' },
      })
    ).toEqual({ startingLocation: '/connections', currentPath: '/explore', launchSource: 'custom_guide' });
  });

  it('uses unknown for a missing launch source that still needs a prompt', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        launchSource: null,
        packageManifest: { startingLocation: '/connections' },
      })
    ).toEqual({ startingLocation: '/connections', currentPath: '/explore', launchSource: 'unknown' });
  });

  it.each([
    { name: 'missing location', packageManifest: {} },
    { name: 'unsafe location', packageManifest: { startingLocation: 'https://example.com' } },
    { name: 'non-admin location', packageManifest: { startingLocation: '/admin/users' } },
  ])('suppresses a prompt for a $name', ({ packageManifest }) => {
    expect(resolveDocsLoadAlignment({ ...alignmentInput, packageManifest })).toBeUndefined();
  });

  it('suppresses an otherwise valid decision in full-screen mode', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        isFullScreen: true,
        packageManifest: { startingLocation: '/connections' },
      })
    ).toBeUndefined();
  });

  it('does not read the clock or browser environment', () => {
    const now = jest.spyOn(Date, 'now');

    resolveDocsLoadAlignment({
      ...alignmentInput,
      packageManifest: { startingLocation: '/connections' },
    });

    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe('buildDocsLoadSuccessPatch', () => {
  it.each([
    {
      name: 'keeps an existing base URL',
      inputTab: tab({ baseUrl: 'bundled:existing' }),
      fetchedContent: content({ url: 'bundled:fetched' }),
      expected: 'bundled:existing',
    },
    {
      name: 'falls back to the fetched URL for an empty base URL',
      inputTab: tab({ baseUrl: '' }),
      fetchedContent: content({ url: 'bundled:fetched' }),
      expected: 'bundled:fetched',
    },
  ])('$name', ({ inputTab, fetchedContent, expected }) => {
    expect(
      buildDocsLoadSuccessPatch({ tab: inputTab, requestedUrl: 'bundled:requested', fetchedContent }).baseUrl
    ).toBe(expected);
  });

  it.each([
    { name: 'uses the fetched URL', fetchedUrl: 'bundled:fetched', expected: 'bundled:fetched' },
    { name: 'falls back to the requested URL', fetchedUrl: '', expected: 'bundled:requested' },
  ])('$name for currentUrl', ({ fetchedUrl, expected }) => {
    expect(
      buildDocsLoadSuccessPatch({
        tab: tab(),
        requestedUrl: 'bundled:requested',
        fetchedContent: content({ url: fetchedUrl }),
      }).currentUrl
    ).toBe(expected);
  });

  it('uses package render type and the supplied package info', () => {
    const packageInfo: PackageOpenInfo = { packageId: 'path-1', packageManifest: { type: 'path' } };

    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ packageInfo: { packageId: 'old' } }),
      requestedUrl: 'bundled:requested',
      fetchedContent: content(),
      packageInfo,
    });

    expect(patch.type).toBe('learning-journey');
    expect(patch.packageInfo).toBe(packageInfo);
  });

  it('uses interactive type without package info for interactive content', () => {
    expect(
      buildDocsLoadSuccessPatch({
        tab: tab({ type: 'docs' }),
        requestedUrl: 'bundled:requested',
        fetchedContent: content({ type: 'interactive' }),
      }).type
    ).toBe('interactive');
  });

  it('preserves the tab type and package info for non-interactive content', () => {
    const packageInfo: PackageOpenInfo = { packageId: 'existing' };

    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ type: 'docs', packageInfo }),
      requestedUrl: 'https://grafana.com/docs/',
      fetchedContent: content({ type: 'single-doc' }),
    });

    expect(patch.type).toBe('docs');
    expect(patch.packageInfo).toBe(packageInfo);
  });

  it('creates path context from learning-journey metadata by reference', () => {
    const learningJourney = {
      currentMilestone: 1,
      totalMilestones: 2,
      milestones: [],
      baseUrl: 'bundled:path-1',
    };

    const patch = buildDocsLoadSuccessPatch({
      tab: tab(),
      requestedUrl: 'bundled:requested',
      fetchedContent: content({ metadata: { title: 'Path', learningJourney } }),
    });

    expect(patch.pathContext).toEqual({ learningJourney });
    expect(patch.pathContext?.learningJourney).toBe(learningJourney);
  });

  it('clears path context when learning-journey metadata is absent', () => {
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({
        pathContext: {
          learningJourney: { currentMilestone: 1, totalMilestones: 1, milestones: [], baseUrl: 'old' },
        },
      }),
      requestedUrl: 'bundled:requested',
      fetchedContent: content(),
    });

    expect(patch.pathContext).toBeUndefined();
  });

  it('passes pending alignment through by reference and clears it when absent', () => {
    const pendingAlignment: PendingAlignment = {
      startingLocation: '/connections',
      currentPath: '/explore',
      launchSource: 'home_page',
      decidedAt: 123,
    };
    const withPending = buildDocsLoadSuccessPatch({
      tab: tab(),
      requestedUrl: 'bundled:requested',
      fetchedContent: content(),
      pendingAlignment,
    });
    const withoutPending = buildDocsLoadSuccessPatch({
      tab: tab({ pendingAlignment }),
      requestedUrl: 'bundled:requested',
      fetchedContent: content(),
    });

    expect(withPending.pendingAlignment).toBe(pendingAlignment);
    expect(withoutPending.pendingAlignment).toBeUndefined();
  });

  it('returns only success fields without mutating inputs', () => {
    const packageInfo: PackageOpenInfo = { packageId: 'path-1', packageManifest: { type: 'path' } };
    const learningJourney = {
      currentMilestone: 1,
      totalMilestones: 1,
      milestones: [],
      baseUrl: 'bundled:path-1',
    };
    const inputTab = tab({ packageInfo });
    const fetchedContent = content({ metadata: { title: 'Path', learningJourney } });
    const originalTab = { ...inputTab };
    const originalMetadata = { ...fetchedContent.metadata };

    const patch = buildDocsLoadSuccessPatch({
      tab: inputTab,
      requestedUrl: 'bundled:requested',
      fetchedContent,
      packageInfo,
    });

    expect(Object.keys(patch).sort()).toEqual([
      'baseUrl',
      'content',
      'currentUrl',
      'packageInfo',
      'pathContext',
      'pendingAlignment',
      'type',
    ]);
    expect(patch).not.toHaveProperty('isLoading');
    expect(patch).not.toHaveProperty('error');
    expect(inputTab).toEqual(originalTab);
    expect(inputTab.packageInfo).toBe(packageInfo);
    expect(fetchedContent.metadata).toEqual(originalMetadata);
    expect(fetchedContent.metadata.learningJourney).toBe(learningJourney);
    expect(packageInfo).toEqual({ packageId: 'path-1', packageManifest: { type: 'path' } });
  });
});
