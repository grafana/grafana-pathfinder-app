import * as fs from 'fs';
import * as path from 'path';

import { AchievementEventsResponseWireSchema } from '../../types/backend-api.schema';

import {
  bestTier,
  selectAnnouncements,
  type AchievementDecision,
  type AchievementDefinitions,
} from './achievement-announcements';

const CONTRACT_DIR = path.resolve(__dirname, '..', '..', '..', 'pkg', 'plugin', 'testdata', 'contract');

function eventsFixture(name: string) {
  return AchievementEventsResponseWireSchema.parse(
    JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, `achievements-events.${name}.json`), 'utf8'))
  );
}

const definitions: AchievementDefinitions = {
  version: 'v1',
  artBase: 'https://interactive-learning.grafana.net/achievements/art/',
  achievements: [
    {
      id: 'dash-builder',
      title: 'Dashboard builder',
      description: 'Build dashboards.',
      tiers: [
        { id: 'bronze', at: 1 },
        { id: 'silver', at: 3 },
        { id: 'gold', at: 5 },
      ],
      earnable: true,
    },
    {
      id: 'guide-routes',
      title: 'Guide routes',
      description: 'Take a route.',
      tiers: [{ id: 'intro' }],
      earnable: true,
    },
  ],
};

function decision(overrides: Partial<AchievementDecision>): AchievementDecision {
  return {
    achievementId: 'dash-builder',
    decision: 'tier_up',
    awarded: [],
    final: false,
    units: 0,
    next: null,
    ...overrides,
  };
}

describe('selectAnnouncements', () => {
  it('announces the tier-up in the tier-up contract fixture', () => {
    expect(selectAnnouncements(eventsFixture('tier-up').decisions, definitions, [])).toEqual([
      { achievementId: 'dash-builder', tierId: 'silver', kind: 'tier_up', final: false },
    ]);
  });

  it('announces the milestone award in the milestone contract fixture', () => {
    expect(selectAnnouncements(eventsFixture('milestone-award').decisions, definitions, [])).toEqual([
      { achievementId: 'guide-routes', tierId: 'intro', kind: 'award', final: true },
    ]);
  });

  it('announces nothing for the retry and no-selection fixtures', () => {
    expect(selectAnnouncements(eventsFixture('retry').decisions, definitions, [])).toEqual([]);
    expect(selectAnnouncements(eventsFixture('no-selection').decisions, definitions, [])).toEqual([]);
  });

  it('announces only the best tier when one event awards several tiers', () => {
    const decisions = [decision({ decision: 'award', awarded: ['bronze', 'silver', 'gold'], final: true })];
    expect(selectAnnouncements(decisions, definitions, [])).toEqual([
      { achievementId: 'dash-builder', tierId: 'gold', kind: 'award', final: true },
    ]);
  });

  it('ranks by catalog order, not by the order the response lists the tiers', () => {
    const decisions = [decision({ awarded: ['gold', 'bronze'] })];
    expect(selectAnnouncements(decisions, definitions, [])[0]?.tierId).toBe('gold');
  });

  it('does not announce a newly held tier that ranks below a tier already held', () => {
    const decisions = [decision({ awarded: ['silver'] })];
    expect(selectAnnouncements(decisions, definitions, [{ achievementId: 'dash-builder', tierId: 'gold' }])).toEqual(
      []
    );
  });

  it('still announces when the held tier is the same or lower', () => {
    const decisions = [decision({ awarded: ['silver'] })];
    const held = [
      { achievementId: 'dash-builder', tierId: 'bronze' },
      { achievementId: 'dash-builder', tierId: 'silver' },
    ];
    expect(selectAnnouncements(decisions, definitions, held)).toHaveLength(1);
  });

  it('gives one announcement per achievement when one event awards several achievements', () => {
    const decisions = [
      decision({ decision: 'award', awarded: ['bronze'] }),
      decision({ achievementId: 'guide-routes', decision: 'award', awarded: ['intro'], final: true }),
    ];
    expect(selectAnnouncements(decisions, definitions, []).map((a) => a.achievementId)).toEqual([
      'dash-builder',
      'guide-routes',
    ]);
  });

  it('skips increments and ignored decisions', () => {
    const decisions = [
      decision({ decision: 'increment', units: 2, next: 3 }),
      decision({ decision: 'ignored', reason: 'duplicate' }),
    ];
    expect(selectAnnouncements(decisions, definitions, [])).toEqual([]);
  });
});

describe('bestTier', () => {
  it('ranks a tier the catalog does not know below every known tier', () => {
    expect(bestTier(definitions, 'dash-builder', ['silver', 'platinum'])).toBe('silver');
  });

  it('keeps wire order among tiers of an achievement the catalog does not list', () => {
    expect(bestTier(definitions, 'unknown', ['a', 'b'])).toBe('b');
  });

  it('returns undefined for no tiers', () => {
    expect(bestTier(definitions, 'dash-builder', [])).toBeUndefined();
  });
});
