import * as fs from 'fs';
import * as path from 'path';

import React from 'react';
import { act, render, screen, within } from '@testing-library/react';

import {
  announceEvaluated,
  loadMyAchievements,
  __resetAchievementDisplayForTests,
  __setAchievementDisplayDepsForTests,
} from '../../completion-records/achievements/achievement-display';
import type { AchievementDefinitions, MyAchievementsResult } from '../../completion-records/achievements';
import { testIds } from '../../constants/testIds';
import { MyAchievementsResponseWireSchema } from '../../types/backend-api.schema';
import type { getMyLearningStyles } from '../LearningPaths/MyLearningTab.styles';

import { AchievementsSection } from './AchievementsSection';
import { buildAchievementsView } from './achievements-view';

const mockFlag = jest.fn(() => true);
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: () => mockFlag() }));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values?.[name])),
}));

const CONTRACT_DIR = path.resolve(__dirname, '..', '..', '..', 'pkg', 'plugin', 'testdata', 'contract');
function myFixture(name: string): MyAchievementsResult {
  const data = MyAchievementsResponseWireSchema.parse(
    JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, `achievements-my.${name}.json`), 'utf8'))
  );
  return data.capability.available ? { kind: 'ok', data } : { kind: 'unavailable' };
}

const definitions: AchievementDefinitions = {
  version: 'cc05e90009762e27',
  artBase: 'https://interactive-learning.grafana.net/achievements/art/',
  achievements: [
    {
      id: 'dash-builder',
      title: 'Dashboard builder',
      description: 'Build dashboards.',
      tiers: [
        { id: 'bronze', at: 1, art: 'dash-builder-1' },
        { id: 'silver', at: 3, art: 'dash-builder-2' },
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
    { id: 'retired', title: 'Retired', description: 'Old.', tiers: [{ id: 'bronze', at: 1 }], earnable: false },
  ],
};

const styles = new Proxy({}, { get: (_t, prop) => String(prop) }) as ReturnType<typeof getMyLearningStyles>;

async function renderWith(my: MyAchievementsResult, defs: AchievementDefinitions | null) {
  __setAchievementDisplayDepsForTests({ fetchMy: async () => my, fetchDefinitions: async () => defs });
  render(<AchievementsSection styles={styles} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  __resetAchievementDisplayForTests();
  mockFlag.mockReturnValue(true);
});

describe('AchievementsSection', () => {
  it('shows each earned achievement at its best tier, with progress toward the next', async () => {
    await renderWith(myFixture('default'), definitions);
    const dash = screen.getByTestId(testIds.achievements.hubRow('dash-builder'));
    expect(within(dash).getByText('Dashboard builder')).toBeInTheDocument();
    expect(within(dash).getByText('Silver')).toBeInTheDocument();
    expect(within(dash).queryByText('Bronze')).not.toBeInTheDocument();
    expect(within(dash).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(within(dash).getByText('3 of 5 toward the next tier')).toBeInTheDocument();
    expect(within(dash).getByTestId('achievement-badge-image')).toHaveAttribute(
      'src',
      'https://interactive-learning.grafana.net/achievements/art/dash-builder-2.svg'
    );
    const route = screen.getByTestId(testIds.achievements.hubRow('guide-routes'));
    expect(within(route).getByText('Intro')).toBeInTheDocument();
    expect(within(route).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('uses the bundled fallback badge when a tier has no art', async () => {
    const data = myFixture('default');
    if (data.kind === 'ok') {
      data.data.awards.push({ achievementId: 'dash-builder', tierId: 'gold', entity: 'dashboards', earnedAt: '' });
    }
    await renderWith(data, definitions);
    const dash = screen.getByTestId(testIds.achievements.hubRow('dash-builder'));
    expect(within(dash).getByText('Gold')).toBeInTheDocument();
    expect(within(dash).getByTestId('achievement-badge-image').getAttribute('src')).not.toContain(
      'interactive-learning'
    );
  });

  it('shows the empty state when nothing is earned yet', async () => {
    await renderWith(myFixture('empty'), definitions);
    expect(screen.getByTestId(testIds.achievements.hubEmpty)).toBeInTheDocument();
  });

  it('notes a truncated read', async () => {
    await renderWith(myFixture('truncated'), definitions);
    expect(screen.getByText('Some achievements could not be loaded.')).toBeInTheDocument();
  });

  it('renders nothing when achievements are unavailable on the stack', async () => {
    await renderWith(myFixture('unavailable'), definitions);
    expect(screen.queryByTestId(testIds.achievements.hubSection)).not.toBeInTheDocument();
  });

  it('degrades to a short note when /definitions is unavailable', async () => {
    await renderWith(myFixture('default'), null);
    expect(screen.getByTestId(testIds.achievements.hubUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the note, not a blank, when achievements are available but the section cannot read them', async () => {
    const fetchMy = jest.fn<Promise<MyAchievementsResult>, []>(async () => myFixture('default'));
    __setAchievementDisplayDepsForTests({ fetchMy, fetchDefinitions: async () => definitions });
    await loadMyAchievements();
    fetchMy.mockResolvedValue({ kind: 'unavailable' });
    render(<AchievementsSection styles={styles} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId(testIds.achievements.hubUnavailable)).toBeInTheDocument();
  });

  it('keeps the rows it showed when a refresh after an evaluated event fails', async () => {
    const fetchMy = jest.fn<Promise<MyAchievementsResult>, []>(async () => myFixture('default'));
    await renderWith(myFixture('default'), definitions);
    __setAchievementDisplayDepsForTests({ fetchMy });
    fetchMy.mockResolvedValue({ kind: 'unavailable' });
    await act(async () => {
      await announceEvaluated({
        eventId: 'e',
        retry: false,
        decisions: [
          { achievementId: 'dash-builder', decision: 'increment', awarded: [], final: false, units: 4, next: 5 },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMy).toHaveBeenCalled();
    expect(screen.getByTestId(testIds.achievements.hubRow('dash-builder'))).toBeInTheDocument();
  });

  it('renders nothing and requests nothing when the flag is off', async () => {
    mockFlag.mockReturnValue(false);
    const fetchMy = jest.fn(async () => myFixture('default'));
    __setAchievementDisplayDepsForTests({ fetchMy });
    render(<AchievementsSection styles={styles} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId(testIds.achievements.hubSection)).not.toBeInTheDocument();
    expect(fetchMy).not.toHaveBeenCalled();
  });
});

describe('buildAchievementsView', () => {
  it('never shows progress for an achievement that is not earnable, but still shows it once earned', () => {
    const my: MyAchievementsResult = {
      kind: 'ok',
      data: {
        capability: { available: true },
        truncated: false,
        awards: [],
        progress: [{ achievementId: 'retired', units: 0, next: 1 }],
        legacy: [],
      },
    };
    const view = buildAchievementsView(my, definitions);
    expect(view.kind === 'ready' && view.rows.map((r) => r.id)).toEqual([]);

    if (my.kind === 'ok') {
      my.data.awards.push({ achievementId: 'retired', tierId: 'bronze', entity: 'guides', earnedAt: '' });
    }
    const earned = buildAchievementsView(my, definitions);
    expect(earned.kind === 'ready' && earned.rows).toEqual([
      expect.objectContaining({ id: 'retired', progress: null }),
    ]);
  });

  it('lists an earnable achievement in progress before its first tier', () => {
    const my: MyAchievementsResult = {
      kind: 'ok',
      data: {
        capability: { available: true },
        truncated: false,
        awards: [],
        progress: [{ achievementId: 'dash-builder', units: 0, next: 1 }],
        legacy: [],
      },
    };
    expect(buildAchievementsView(my, definitions)).toEqual({ kind: 'ready', rows: [], truncated: false });
  });
});
