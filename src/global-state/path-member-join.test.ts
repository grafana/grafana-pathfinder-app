/**
 * The join's contract: for every surface a path member can be launched from,
 * the key the member persists under must be one of the keys the join looks it
 * up by. The launch side is exercised through the real `getContentKey`, so a
 * change to either sanitizer or scheme fails here rather than silently
 * reporting a member at 0%.
 */
import { createBundledResolver } from '../package-engine/resolver';

import { getContentKey, resetContentKeyForTests, setActiveTabUrl } from './content-key';
import {
  pathMemberContentKeys,
  pathMemberIdSchemeKeys,
  resolvePathMemberPercentage,
  resolvePathMemberPercentages,
  type PathMember,
  type PathMemberJoinContext,
} from './path-member-join';

const EMPTY_CONTEXT: PathMemberJoinContext = {
  completedMemberIds: [],
  persistedPercentages: {},
};

function contextWith(overrides: Partial<PathMemberJoinContext>): PathMemberJoinContext {
  return { ...EMPTY_CONTEXT, ...overrides };
}

/** The key a launch from `launchUrl` would persist under. */
function keyPersistedByLaunch(launchUrl: string): string {
  setActiveTabUrl(launchUrl);
  return getContentKey();
}

describe('path-member-join launch round-trip', () => {
  beforeEach(() => {
    resetContentKeyForTests();
    delete (window as unknown as Record<string, unknown>).__DocsPluginActiveTabUrl;
    delete (window as unknown as Record<string, unknown>).__DocsPluginContentKey;
  });

  it('looks up a URL-based path milestone under the key its launch persists', () => {
    const url = 'https://grafana.com/docs/learning-journeys/loki/step-two/';
    const member: PathMember = { id: 'step-two', url };

    expect(pathMemberContentKeys(member, 'https://grafana.com/docs/learning-journeys/loki/')).toContain(
      keyPersistedByLaunch(url)
    );
  });

  it('looks up an App Platform member under the key its launch persists', () => {
    const member: PathMember = { id: 'fe-alerting-01', url: 'backend-guide:fe-alerting-01' };

    expect(pathMemberContentKeys(member)).toContain(keyPersistedByLaunch('backend-guide:fe-alerting-01'));
  });

  it('looks up a bundled member under the key its launch persists', () => {
    const member: PathMember = { id: 'welcome-to-grafana' };

    expect(pathMemberContentKeys(member)).toContain(keyPersistedByLaunch('bundled:welcome-to-grafana'));
  });

  it('covers every scheme for a member whose launch URL has not resolved yet', () => {
    // An App Platform member before its catalogue loads carries no url, and is
    // indistinguishable from a bundled member at that point.
    const member: PathMember = { id: 'fe-alerting-01' };

    expect(pathMemberContentKeys(member)).toEqual([
      keyPersistedByLaunch('bundled:fe-alerting-01'),
      keyPersistedByLaunch('bundled:fe-alerting-01/content.json'),
      keyPersistedByLaunch('backend-guide:fe-alerting-01'),
    ]);
  });

  it.each(createBundledResolver().listPackageIds())(
    'looks up %s under the key a package-resolved launch persists',
    async (packageId) => {
      // The context panel opens a recommended package at its resolved
      // contentUrl, which the resolver derives from the repository entry's
      // `path` rather than its id. Walking every entry catches a divergent one.
      const resolution = await createBundledResolver().resolve(packageId);
      if (!resolution.ok) {
        throw new Error(`expected ${packageId} to resolve from the bundled repository`);
      }

      expect(pathMemberContentKeys({ id: packageId })).toContain(keyPersistedByLaunch(resolution.contentUrl));
    }
  );

  it('scores a bundled member progressed from a package launch rather than excluding it', async () => {
    const packageId = 'first-dashboard';
    const resolution = await createBundledResolver().resolve(packageId);
    if (!resolution.ok) {
      throw new Error(`expected ${packageId} to resolve from the bundled repository`);
    }
    const persistedKey = keyPersistedByLaunch(resolution.contentUrl);

    const result = resolvePathMemberPercentage(
      { id: packageId },
      contextWith({ persistedPercentages: { [persistedKey]: 50 } })
    );

    expect(result).toEqual({ memberId: packageId, percent: 50, source: 'persisted', contentKey: persistedKey });
  });

  it('pairs a resolved package-form URL with its bare sibling', () => {
    expect(pathMemberContentKeys({ id: 'first-dashboard', url: 'bundled:first-dashboard/content.json' })).toEqual([
      keyPersistedByLaunch('bundled:first-dashboard/content.json'),
      keyPersistedByLaunch('bundled:first-dashboard'),
    ]);
  });

  it('pairs a resolved bare bundled URL with its package-form sibling', () => {
    expect(pathMemberContentKeys({ id: 'first-dashboard', url: 'bundled:first-dashboard' })).toEqual([
      keyPersistedByLaunch('bundled:first-dashboard'),
      keyPersistedByLaunch('bundled:first-dashboard/content.json'),
    ]);
  });

  it('applies the content-key sanitizer to the member URL', () => {
    const url = 'https://grafana.com/docs/../learning-journeys/loki/step-two/';

    expect(pathMemberContentKeys({ id: 'step-two', url }, 'https://grafana.com/docs/')).toEqual([
      keyPersistedByLaunch(url),
    ]);
  });
});

describe('pathMemberContentKeys', () => {
  it('forms no key for a URL-based path member whose URL did not resolve', () => {
    expect(pathMemberContentKeys({ id: 'step-two' }, 'https://grafana.com/docs/learning-journeys/loki/')).toEqual([]);
  });

  it('prefers the resolved URL over the id schemes', () => {
    expect(pathMemberContentKeys({ id: 'fe-alerting-01', url: 'backend-guide:fe-alerting-01' })).toEqual([
      'backend-guide:fe-alerting-01',
    ]);
  });
});

describe('pathMemberIdSchemeKeys', () => {
  it('carries both bundled launch shapes and the backend-guide shape, unsanitized', () => {
    expect(pathMemberIdSchemeKeys('guide-a')).toEqual([
      'bundled:guide-a',
      'bundled:guide-a/content.json',
      'backend-guide:guide-a',
    ]);
  });

  it('leaves a traversal sequence intact for the raw-keyed namespaces', () => {
    expect(pathMemberIdSchemeKeys('a..b')).toContain('bundled:a..b');
  });
});

describe('resolvePathMemberPercentage', () => {
  it('reports a completed member as 100 without consulting the record', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ completedMemberIds: ['guide-a'], persistedPercentages: { 'bundled:guide-a': 25 } })
    );

    expect(resolution).toEqual({ memberId: 'guide-a', percent: 100, source: 'completed' });
  });

  it('reads the persisted percentage under the bundled scheme', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'bundled:guide-a': 40 } })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 40,
      source: 'persisted',
      contentKey: 'bundled:guide-a',
    });
  });

  it('falls through to the backend-guide scheme when the bundled key holds nothing', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'backend-guide:guide-a': 60 } })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 60,
      source: 'persisted',
      contentKey: 'backend-guide:guide-a',
    });
  });

  it('takes the furthest record when both bundled launch shapes hold one', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({
        persistedPercentages: { 'bundled:guide-a': 30, 'bundled:guide-a/content.json': 90 },
      })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 90,
      source: 'persisted',
      contentKey: 'bundled:guide-a/content.json',
    });
  });

  it('takes the furthest record regardless of candidate order', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({
        persistedPercentages: { 'bundled:guide-a': 90, 'bundled:guide-a/content.json': 30 },
      })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 90,
      source: 'persisted',
      contentKey: 'bundled:guide-a',
    });
  });

  it('takes the furthest record across both sibling shapes of a resolved URL', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a', url: 'bundled:guide-a/content.json' },
      contextWith({
        persistedPercentages: { 'bundled:guide-a': 75, 'bundled:guide-a/content.json': 20 },
      })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 75,
      source: 'persisted',
      contentKey: 'bundled:guide-a',
    });
  });

  it('prefers a readable record over an unreadable sibling', () => {
    const persisted = { 'bundled:guide-a': '40', 'backend-guide:guide-a': 70 } as unknown as Record<string, number>;

    const resolution = resolvePathMemberPercentage({ id: 'guide-a' }, contextWith({ persistedPercentages: persisted }));

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 70,
      source: 'persisted',
      contentKey: 'backend-guide:guide-a',
    });
  });

  it('excludes and counts a member whose only record is unreadable', () => {
    const persisted = { 'bundled:guide-a': Number.NaN } as Record<string, number>;

    const result = resolvePathMemberPercentages([{ id: 'guide-a' }], contextWith({ persistedPercentages: persisted }));

    expect(result.members[0]).toEqual({ memberId: 'guide-a', percent: undefined, source: 'unreadable' });
    expect(result.resolvedPercentages).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
    expect(result.unresolvedMemberIds).toEqual(['guide-a']);
  });

  it('excludes and counts a member whose only record is out of range', () => {
    const persisted = { 'bundled:guide-a': 500 } as Record<string, number>;

    const result = resolvePathMemberPercentages([{ id: 'guide-a' }], contextWith({ persistedPercentages: persisted }));

    expect(result.members[0]).toEqual({ memberId: 'guide-a', percent: undefined, source: 'unreadable' });
    expect(result.resolvedPercentages).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
  });

  it('does not let an out-of-range record win over a readable sibling', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'bundled:guide-a': 40, 'bundled:guide-a/content.json': 500 } })
    );

    expect(resolution).toEqual({
      memberId: 'guide-a',
      percent: 40,
      source: 'persisted',
      contentKey: 'bundled:guide-a',
    });
  });

  it('excludes a negative record rather than letting it into the mean', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'bundled:guide-a': -10 } })
    );

    expect(resolution).toEqual({ memberId: 'guide-a', percent: undefined, source: 'unreadable' });
  });

  it('accepts the range boundaries', () => {
    const atZero = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'bundled:guide-a': 0 } })
    );
    const atHundred = resolvePathMemberPercentage(
      { id: 'guide-b' },
      contextWith({ persistedPercentages: { 'bundled:guide-b': 100 } })
    );

    expect(atZero.source).toBe('persisted');
    expect(atZero.percent).toBe(0);
    expect(atHundred.source).toBe('persisted');
    expect(atHundred.percent).toBe(100);
  });

  it('excludes and counts a member whose record is not a number at all', () => {
    const persisted = { 'bundled:guide-a': 'nearly done' } as unknown as Record<string, number>;

    const result = resolvePathMemberPercentages([{ id: 'guide-a' }], contextWith({ persistedPercentages: persisted }));

    expect(result.members[0]!.source).toBe('unreadable');
    expect(result.resolvedPercentages).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
  });

  it('distinguishes a persisted zero from a member that was never opened', () => {
    const persisted = resolvePathMemberPercentage(
      { id: 'guide-a' },
      contextWith({ persistedPercentages: { 'bundled:guide-a': 0 } })
    );
    const unopened = resolvePathMemberPercentage({ id: 'guide-b' }, EMPTY_CONTEXT);

    expect(persisted.source).toBe('persisted');
    expect(unopened.source).toBe('unopened');
    expect(unopened.percent).toBe(0);
  });

  it('resolves a member id that collides with an Object.prototype key', () => {
    const resolution = resolvePathMemberPercentage({ id: 'toString' }, EMPTY_CONTEXT);

    expect(resolution).toEqual({ memberId: 'toString', percent: 0, source: 'unopened' });
  });

  it('marks a member with no formable key unresolved rather than zero', () => {
    const resolution = resolvePathMemberPercentage(
      { id: 'step-two' },
      contextWith({ pathBaseUrl: 'https://grafana.com/docs/learning-journeys/loki/' })
    );

    expect(resolution).toEqual({ memberId: 'step-two', percent: undefined, source: 'unresolved' });
  });
});

describe('resolvePathMemberPercentages', () => {
  it('excludes unresolved members from the percentages and counts them', () => {
    const members: PathMember[] = [
      { id: 'step-one', url: 'https://grafana.com/docs/lj/loki/step-one/' },
      { id: 'step-two' },
      { id: 'step-three' },
    ];

    const result = resolvePathMemberPercentages(
      members,
      contextWith({
        pathBaseUrl: 'https://grafana.com/docs/lj/loki/',
        persistedPercentages: { 'https://grafana.com/docs/lj/loki/step-one/': 50 },
      })
    );

    expect(result.resolvedPercentages).toEqual([50]);
    expect(result.unresolvedCount).toBe(2);
    expect(result.unresolvedMemberIds).toEqual(['step-two', 'step-three']);
  });

  it('reports nothing unresolved for a path whose members all key by id scheme', () => {
    const result = resolvePathMemberPercentages(
      [{ id: 'guide-a' }, { id: 'guide-b' }],
      contextWith({ completedMemberIds: ['guide-a'], persistedPercentages: { 'backend-guide:guide-b': 30 } })
    );

    expect(result.resolvedPercentages).toEqual([100, 30]);
    expect(result.unresolvedCount).toBe(0);
    expect(result.unresolvedMemberIds).toEqual([]);
  });

  it('returns an empty result for a path with no members', () => {
    const result = resolvePathMemberPercentages([], EMPTY_CONTEXT);

    expect(result.members).toEqual([]);
    expect(result.resolvedPercentages).toEqual([]);
    expect(result.unresolvedCount).toBe(0);
  });
});
