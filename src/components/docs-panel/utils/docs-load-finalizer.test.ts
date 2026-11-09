import type { LearningJourneyTab, PackageOpenInfo, PendingAlignment } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import { fetchContent } from '../../../docs-retrieval/content-fetcher';
import { findDocPage } from '../../../utils/find-doc-page';
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

  it('prefers the fetched manifest when the package manifest comes from the enclosing path', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        packageManifest: { startingLocation: '/connections' },
        fetchedManifest: { startingLocation: '/alerting' },
        packageManifestIsFromEnclosingPath: true,
      })
    ).toEqual({ startingLocation: '/alerting', currentPath: '/explore', launchSource: 'home_page' });
  });

  it('falls back to the enclosing path manifest when the fetched manifest declares none', () => {
    expect(
      resolveDocsLoadAlignment({
        ...alignmentInput,
        packageManifest: { startingLocation: '/connections' },
        fetchedManifest: { id: 'guide-1' },
        packageManifestIsFromEnclosingPath: true,
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
  it('keeps the PR-tester marker on the content key after a real load', async () => {
    const markedUrl = 'https://interactive-learning.grafana.net/packages/guide-two/v1.0.0/content.json#pf-pr-abc123';
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn((input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        status: 200,
        url: String(input),
        text: async () => JSON.stringify({ id: 'guide-two', title: 'Guide two', blocks: [] }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as Response)
    );
    global.fetch = fetchSpy;
    try {
      const { content: fetchedContent } = await fetchContent(markedUrl);
      const patch = buildDocsLoadSuccessPatch({
        tab: tab({ baseUrl: markedUrl, currentUrl: markedUrl }),
        requestedUrl: markedUrl,
        fetchedContent: fetchedContent!,
      });

      expect(patch.currentUrl).toBe(markedUrl);
      expect(patch.content?.url).toBe(markedUrl);
      expect(fetchSpy.mock.calls.every(([input]) => !String(input).includes('#'))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

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

  it.each(['content.json', 'unstyled.html', '', 'content.json?source=website#start'])(
    'replaces a CDN deep-link placeholder with the fetched title (%s)',
    (suffix) => {
      const url = `https://interactive-learning.grafana.net/packages/alerting-intro-lj/${suffix}`;
      const page = findDocPage(url)!;
      const patch = buildDocsLoadSuccessPatch({
        tab: tab({ title: page.title, baseUrl: page.url }),
        requestedUrl: page.url,
        fetchedContent: content({ metadata: { title: 'Getting started with alerting' } }),
        packageInfo: { packageId: 'alerting-intro-lj', packageManifest: { type: 'path' } },
      });

      expect(patch.title).toBe('Getting started with alerting');
    }
  );

  it.each(['', '   '])('keeps a CDN placeholder when the fetched title is empty (%j)', (title) => {
    const url = 'https://interactive-learning.grafana.net/packages/alerting-intro-lj/content.json';
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'Alerting Intro Lj', baseUrl: url }),
      requestedUrl: url,
      fetchedContent: content({ metadata: { title } }),
    });

    expect(patch.title).toBeUndefined();
  });

  it('preserves an established CDN title on reload', () => {
    const url = 'https://interactive-learning.grafana.net/packages/alerting-intro-lj/content.json';
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'Getting started with alerting', baseUrl: url }),
      requestedUrl: url,
      fetchedContent: content({ metadata: { title: 'Another title' } }),
    });

    expect(patch.title).toBeUndefined();
  });

  it('does not replace a path title with a milestone title even when it matches the URL slug', () => {
    const url = 'https://interactive-learning.grafana.net/packages/alerting-intro-lj/content.json';
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'Alerting Intro Lj', baseUrl: url }),
      requestedUrl: 'https://interactive-learning.grafana.net/packages/first-rule/content.json',
      fetchedContent: content({ metadata: { title: 'Create your first alert rule' } }),
    });

    expect(patch.title).toBeUndefined();
  });

  it('replaces a backend-guide resource name with the fetched guide title', () => {
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'alerting-intro-lj', baseUrl: 'backend-guide:alerting-intro-lj' }),
      requestedUrl: 'backend-guide:alerting-intro-lj',
      fetchedContent: content({
        url: 'backend-guide:alerting-intro-lj',
        metadata: { title: 'Getting started with alerting' },
      }),
    });

    expect(patch.title).toBe('Getting started with alerting');
  });

  it('keeps a title that was already set, and does not retitle bundled guides', () => {
    const launched = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'Getting started with alerting', baseUrl: 'backend-guide:alerting-intro-lj' }),
      requestedUrl: 'backend-guide:alerting-intro-lj',
      fetchedContent: content({
        url: 'backend-guide:alerting-intro-rules',
        metadata: { title: 'Create your first alert rule' },
      }),
    });
    const bundled = buildDocsLoadSuccessPatch({
      tab: tab({ title: 'Guide one', baseUrl: 'bundled:launch/content.json' }),
      requestedUrl: 'bundled:requested',
      fetchedContent: content({ metadata: { title: 'Some other title' } }),
    });

    expect(launched.title).toBeUndefined();
    expect(bundled.title).toBeUndefined();
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

describe('resolved path locator capture', () => {
  it('retains resolved foundation rows when a matching owner refresh leaves foundations unchanged', () => {
    const manifest = { id: 'owner', type: 'path', milestones: ['same'] };
    const resolvedMilestones = [
      { id: 'same', number: 1, title: 'Same', url: 'bundled:same/content.json', isActive: false },
    ];
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ packageInfo: { packageManifest: manifest, resolvedMilestones } }),
      requestedUrl: 'bundled:owner/content.json',
      fetchedContent: content({
        metadata: {
          title: 'Owner',
          packageManifest: { ...manifest, title: 'Updated' },
          trackMemberBaseUrl: 'bundled:owner/content.json',
        },
      }),
    });
    expect(patch.packageInfo?.packageManifest?.title).toBe('Updated');
    expect(patch.packageInfo?.resolvedMilestones).toBe(resolvedMilestones);
  });

  it.each([
    { type: 'path', repository: 'interactive-tutorials', expected: ['new'] },
    { type: 'journey', repository: 'interactive-tutorials', expected: ['new'] },
    { type: 'guide', repository: 'interactive-tutorials', expected: ['old'] },
    { type: 'path', repository: 'app-platform', expected: ['old'] },
  ])('refreshes foundations only from a matching path owner: %j', ({ type, repository, expected }) => {
    const manifest = {
      id: 'owner',
      type: 'path',
      milestones: ['old'],
      tracks: [{ trackId: 'old-track', label: 'Old', guides: ['old'] }],
      description: 'Retained description',
    };
    const owner = {
      id: 'owner',
      type,
      repository,
      milestones: ['new'],
      tracks: [{ trackId: 'new-track', label: 'New', guides: ['new'] }],
    };
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({
        packageInfo: { packageManifest: manifest, repository: 'interactive-tutorials', resolvedMilestones: [] },
      }),
      requestedUrl: 'bundled:owner/content.json',
      fetchedContent: content({
        metadata: {
          title: 'Owner',
          journeyManifest: owner,
          trackMemberBaseUrl: 'bundled:owner/content.json',
        },
      }),
    });
    expect(patch.packageInfo?.packageManifest?.milestones).toEqual(expected);
    expect(patch.packageInfo?.packageManifest?.tracks).toEqual(expected[0] === 'new' ? owner.tracks : manifest.tracks);
    expect(patch.packageInfo?.packageManifest?.description).toBe('Retained description');
    expect(patch.packageInfo?.resolvedMilestones).toEqual(expected[0] === 'new' ? undefined : []);
    expect(manifest.milestones).toEqual(['old']);
  });

  it.each([
    { name: 'reordered members', ids: ['b', 'a'], lockedId: undefined },
    { name: 'removed member', ids: ['a'], lockedId: undefined },
    { name: 'locked unresolved member', ids: ['b', 'a'], lockedId: 'b' },
    { name: 'removed all tracks', ids: undefined, lockedId: undefined },
  ])('persists authoritative resolved tracks with $name', ({ ids, lockedId }) => {
    const manifest = {
      id: 'owner',
      type: 'path',
      tracks: [
        { trackId: 'advanced', label: 'Old label', guides: ['a', 'b'] },
        { trackId: 'removed', label: 'Removed track', guides: ['c'] },
      ],
    };
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ packageInfo: { packageManifest: manifest } }),
      requestedUrl: 'bundled:owner/content.json',
      fetchedContent: content({
        metadata: {
          title: 'Owner',
          packageManifest: manifest,
          learningJourney: {
            baseUrl: 'bundled:owner/content.json',
            currentMilestone: 0,
            totalMilestones: 0,
            milestones: [],
            tracks: ids
              ? [
                  {
                    trackId: 'advanced',
                    label: 'Current label',
                    milestones: ids.map((id, index) => ({
                      id,
                      number: index + 1,
                      title: id,
                      url: id === lockedId ? '' : `bundled:${id}/content.json`,
                      isActive: false,
                      isLocked: id === lockedId,
                    })),
                  },
                ]
              : [],
          },
        },
      }),
    });
    expect(patch.packageInfo?.packageManifest?.tracks).toEqual(
      ids ? [{ trackId: 'advanced', label: 'Current label', guides: ids }] : []
    );
    expect(manifest.tracks[0]?.guides).toEqual(['a', 'b']);
    expect(manifest.tracks).toHaveLength(2);
  });

  it.each([
    { owner: { id: 'other', type: 'path' }, baseUrl: 'bundled:owner/content.json' },
    { owner: { id: 'owner', type: 'path', repository: 'app-platform' }, baseUrl: 'bundled:owner/content.json' },
    { owner: { id: 'owner', type: 'path' }, baseUrl: 'javascript:alert(1)' },
  ])('does not capture mismatched or unsafe metadata: %j', ({ owner, baseUrl }) => {
    const packageInfo: PackageOpenInfo = {
      packageManifest: { id: 'owner', type: 'path' },
      repository: 'interactive-tutorials',
    };
    const patch = buildDocsLoadSuccessPatch({
      tab: tab({ packageInfo }),
      requestedUrl: 'bundled:member/content.json',
      fetchedContent: content({ metadata: { title: 'Member', journeyManifest: owner, trackMemberBaseUrl: baseUrl } }),
    });
    expect(patch.packageInfo).toBe(packageInfo);
    expect(patch.packageInfo?.resolvedPath).toBeUndefined();
  });
});
