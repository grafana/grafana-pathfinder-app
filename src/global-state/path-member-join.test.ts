/**
 * The join's contract: for every surface a path member can be launched from,
 * the key the member persists under must be one of the keys the join looks it
 * up by. The launch side is exercised through the real `getContentKey`, so a
 * change to either sanitizer or scheme fails here rather than silently
 * reporting a member at 0%.
 */
import { getContentKey, resetContentKeyForTests, setActiveTabUrl } from './content-key';
import {
  pathMemberContentKeys,
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

  it('covers both schemes for a member whose launch URL has not resolved yet', () => {
    // An App Platform member before its catalogue loads carries no url, and is
    // indistinguishable from a bundled member at that point.
    const member: PathMember = { id: 'fe-alerting-01' };

    expect(pathMemberContentKeys(member)).toEqual([
      keyPersistedByLaunch('bundled:fe-alerting-01'),
      keyPersistedByLaunch('backend-guide:fe-alerting-01'),
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
