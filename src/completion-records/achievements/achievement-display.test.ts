import type { AchievementDefinitions } from './achievement-announcements';
import {
  achievementArtUrl,
  achievementsAvailability,
  announceEvaluated,
  loadAchievementDefinitions,
  loadMyAchievements,
  onAchievementAnnounced,
  onAchievementsChanged,
  probeAchievementsAvailability,
  __resetAchievementDisplayForTests,
  __setAchievementDisplayDepsForTests,
} from './achievement-display';
import { classifyEventError, type MyAchievementsResult } from './achievements-client';

const definitions: AchievementDefinitions = {
  version: 'v1',
  artBase: 'https://interactive-learning.grafana.net/achievements/art/',
  achievements: [
    {
      id: 'guides-finished',
      title: 'Guide finisher',
      description: 'Finish guides.',
      tiers: [
        { id: 'bronze', at: 1, art: 'guides-finished-1' },
        { id: 'silver', at: 5 },
      ],
      earnable: true,
    },
  ],
};

const myOk = (awards: Array<{ achievementId: string; tierId: string }> = []): MyAchievementsResult => ({
  kind: 'ok',
  data: {
    capability: { available: true },
    truncated: false,
    awards: awards.map((a) => ({ ...a, entity: 'guides', earnedAt: '2026-11-01T00:00:00Z' })),
    progress: [],
    legacy: [],
  },
});

const tierUp = (tierId: string) => ({
  eventId: 'e',
  retry: false,
  decisions: [
    {
      achievementId: 'guides-finished',
      decision: 'tier_up' as const,
      awarded: [tierId],
      final: false,
      units: 5,
      next: null,
    },
  ],
});

beforeEach(() => {
  __resetAchievementDisplayForTests();
  __setAchievementDisplayDepsForTests({
    fetchDefinitions: jest.fn(async () => definitions),
    fetchMy: jest.fn(async () => myOk()),
  });
});

describe('announceEvaluated', () => {
  it('announces a tier once per page, however many responses report it', async () => {
    const seen = jest.fn();
    onAchievementAnnounced(seen);
    await announceEvaluated(tierUp('silver'));
    await announceEvaluated(tierUp('silver'));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({
      achievementId: 'guides-finished',
      tierId: 'silver',
      kind: 'tier_up',
      final: false,
    });
  });

  it('does not announce a lower tier after a higher one is held', async () => {
    __setAchievementDisplayDepsForTests({
      fetchDefinitions: async () => definitions,
      fetchMy: async () => myOk([{ achievementId: 'guides-finished', tierId: 'silver' }]),
    });
    await loadMyAchievements();
    const seen = jest.fn();
    onAchievementAnnounced(seen);
    await announceEvaluated(tierUp('bronze'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('announces nothing and does not throw when /definitions is unavailable', async () => {
    __setAchievementDisplayDepsForTests({ fetchDefinitions: async () => null });
    const seen = jest.fn();
    onAchievementAnnounced(seen);
    await expect(announceEvaluated(tierUp('silver'))).resolves.toBeUndefined();
    expect(seen).not.toHaveBeenCalled();
  });

  it('tells the hub to refresh after an evaluated award or increment, not after ignored decisions', async () => {
    const changed = jest.fn();
    onAchievementsChanged(changed);
    await announceEvaluated({ eventId: 'e', retry: false, decisions: [] });
    expect(changed).not.toHaveBeenCalled();
    await announceEvaluated(tierUp('silver'));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('announcements across tabs', () => {
  const silver = { achievementId: 'guides-finished', tierId: 'silver', kind: 'tier_up', final: false };
  const relayed = (displayed: boolean) => ({ ...silver, displayed });

  function tab(options: { visible: boolean; claims: Set<string>; bus?: Array<(m: unknown) => void> }) {
    let visible = options.visible;
    let becameVisible: (() => void) | null = null;
    const posted: unknown[] = [];
    const bus = options.bus ?? [];
    let deliver: ((message: unknown) => void) | null = null;
    __setAchievementDisplayDepsForTests({
      fetchDefinitions: async () => definitions,
      isVisible: () => visible,
      onVisible: (listener) => {
        becameVisible = listener;
        return () => (becameVisible = null);
      },
      claim: (key) => !options.claims.has(key) && Boolean(options.claims.add(key)),
      openChannel: () => ({
        post: (message) => {
          posted.push(message);
          bus.forEach((other) => other(message));
        },
        subscribe: (listener) => {
          deliver = listener;
          return () => (deliver = null);
        },
      }),
    });
    const seen = jest.fn();
    onAchievementAnnounced(seen);
    return {
      seen,
      posted,
      receive: (message: unknown) => deliver?.(message),
      show: () => {
        visible = true;
        becameVisible?.();
      },
    };
  }

  it('shows an award in a visible tab right away and tells other tabs it was displayed', async () => {
    const claims = new Set<string>();
    const t = tab({ visible: true, claims });
    await announceEvaluated(tierUp('silver'));
    expect(t.seen).toHaveBeenCalledTimes(1);
    expect(t.posted).toEqual([relayed(true)]);
    expect(claims.has('guides-finished:silver')).toBe(true);
  });

  it('records an award another tab already displayed without showing it, even when its claim is not visible yet', () => {
    const t = tab({ visible: true, claims: new Set() });
    t.receive(relayed(true));
    expect(t.seen).not.toHaveBeenCalled();
  });

  it('holds an award drained while hidden and shows it when the tab becomes visible', async () => {
    const t = tab({ visible: false, claims: new Set() });
    await announceEvaluated(tierUp('silver'));
    expect(t.seen).not.toHaveBeenCalled();
    expect(t.posted).toEqual([relayed(false)]);
    t.show();
    expect(t.seen).toHaveBeenCalledWith(silver);
  });

  it('shows a relayed award in a visible tab, and refreshes the hub', () => {
    const t = tab({ visible: true, claims: new Set() });
    const changed = jest.fn();
    onAchievementsChanged(changed);
    t.receive(relayed(false));
    t.receive(relayed(false));
    expect(t.seen).toHaveBeenCalledTimes(1);
    expect(t.seen).toHaveBeenCalledWith(silver);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does not show an award another tab already displayed', () => {
    const claims = new Set(['guides-finished:silver']);
    const t = tab({ visible: false, claims });
    t.receive(relayed(false));
    t.show();
    expect(t.seen).not.toHaveBeenCalled();
  });

  it('ignores malformed relay messages', () => {
    const t = tab({ visible: true, claims: new Set() });
    t.receive({ ...relayed(false), kind: 'bogus' });
    t.receive(silver);
    t.receive('not an announcement');
    expect(t.seen).not.toHaveBeenCalled();
  });
});

describe('loadAchievementDefinitions', () => {
  it('keeps one copy per page and refetches when a different version is asked for', async () => {
    const fetchDefinitions = jest.fn(async () => definitions);
    __setAchievementDisplayDepsForTests({ fetchDefinitions });
    await loadAchievementDefinitions();
    await loadAchievementDefinitions('v1');
    expect(fetchDefinitions).toHaveBeenCalledTimes(1);
    await loadAchievementDefinitions('v2');
    expect(fetchDefinitions).toHaveBeenCalledTimes(2);
  });
});

describe('availability', () => {
  it('is available once /my reports the capability, and stays so after a later failure', async () => {
    const fetchMy = jest.fn<Promise<MyAchievementsResult>, []>(async () => myOk());
    __setAchievementDisplayDepsForTests({ fetchMy });
    probeAchievementsAvailability();
    await new Promise((r) => setTimeout(r, 0));
    expect(achievementsAvailability()).toBe('available');
    fetchMy.mockResolvedValueOnce({ kind: 'unavailable' });
    await loadMyAchievements();
    expect(achievementsAvailability()).toBe('available');
  });

  it('is unavailable when /my answers unavailable', async () => {
    __setAchievementDisplayDepsForTests({ fetchMy: async () => ({ kind: 'unavailable' }) });
    await loadMyAchievements();
    expect(achievementsAvailability()).toBe('unavailable');
  });
});

describe('achievementArtUrl', () => {
  const base = 'https://interactive-learning.grafana.net/achievements/art/';

  it('joins the CDN base, the key, and .svg', () => {
    expect(achievementArtUrl(base, 'guides-finished-1')).toBe(`${base}guides-finished-1.svg`);
  });

  it.each([
    ['no key', base, undefined],
    ['a key with a path', base, '../evil'],
    ['an uppercase key', base, 'Bad'],
    ['an untrusted host', 'https://example.com/art/', 'ok'],
    ['plain http', 'http://interactive-learning.grafana.net/art/', 'ok'],
    ['a base with a query', `${base}?x=1`, 'ok'],
  ])('returns null for %s', (_label, artBase, key) => {
    expect(achievementArtUrl(artBase, key)).toBeNull();
  });
});

describe('classifyEventError', () => {
  it.each([
    [400, 'terminal'],
    [401, 'transient'],
    [403, 'forbidden'],
    [404, 'route-missing'],
    [429, 'transient'],
    [503, 'transient'],
    [undefined, 'transient'],
  ])('maps %s to %s', (status, kind) => {
    expect(classifyEventError(status)).toEqual({ kind });
  });
});
