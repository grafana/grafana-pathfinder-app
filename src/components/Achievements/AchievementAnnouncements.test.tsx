import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  announceEvaluated,
  __resetAchievementDisplayForTests,
  __setAchievementDisplayDepsForTests,
} from '../../completion-records/achievements/achievement-display';
import type { AchievementDefinitions } from '../../completion-records/achievements';
import { testIds } from '../../constants/testIds';
import type { AchievementEventsResponseWire } from '../../types/backend-api.schema';

import { AchievementAnnouncementHost } from './AchievementAnnouncements';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values?.[name])),
}));

const definitions: AchievementDefinitions = {
  version: 'v1',
  artBase: 'https://interactive-learning.grafana.net/achievements/art/',
  sources: [],
  achievements: [
    {
      id: 'guides-finished',
      title: 'Guide finisher',
      description: 'Finish guides.',
      tiers: [
        { id: 'bronze', at: 1, art: 'guides-finished-1' },
        { id: 'silver', at: 5, art: 'guides-finished-2' },
        { id: 'gold', at: 15, art: 'guides-finished-3' },
      ],
      earnable: true,
    },
  ],
};

function response(
  decision: 'award' | 'tier_up' | 'increment',
  awarded: string[],
  final = false,
  progress: { units: number; next: number | null } = { units: 1, next: null }
): AchievementEventsResponseWire {
  return {
    eventId: 'e',
    retry: false,
    decisions: [{ achievementId: 'guides-finished', decision, awarded, final, ...progress }],
  };
}

async function announce(r: AchievementEventsResponseWire) {
  await act(async () => {
    await announceEvaluated(r);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  __resetAchievementDisplayForTests();
  __setAchievementDisplayDepsForTests({ fetchDefinitions: async () => definitions });
});

describe('AchievementAnnouncementHost', () => {
  it('shows a toast, and no overlay, for a first award', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('award', ['bronze']));
    const toast = screen.getByTestId(testIds.achievements.toast('guides-finished'));
    expect(within(toast).getByText('Achievement earned')).toBeInTheDocument();
    expect(within(toast).getByText('Guide finisher')).toBeInTheDocument();
    expect(within(toast).getByText('Bronze')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.achievements.overlay)).not.toBeInTheDocument();
  });

  it('shows the overlay, and no toast, for a tier-up', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('tier_up', ['silver']));
    const overlay = screen.getByTestId(testIds.achievements.overlay);
    expect(within(overlay).getByText('Tier up')).toBeInTheDocument();
    expect(within(overlay).getByText('Silver')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.achievements.toast('guides-finished'))).not.toBeInTheDocument();
  });

  it('shows only the best tier when one event awards several', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('award', ['bronze', 'silver', 'gold'], true));
    const toast = screen.getByTestId(testIds.achievements.toast('guides-finished'));
    expect(within(toast).getByText('Gold')).toBeInTheDocument();
    expect(within(toast).queryByText('Bronze')).not.toBeInTheDocument();
    expect(within(toast).queryByText('Silver')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('achievement-badge-image')).toHaveLength(1);
  });

  it('uses the final-tier wording when a tier-up reaches the last tier', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('tier_up', ['silver', 'gold'], true));
    const overlay = screen.getByTestId(testIds.achievements.overlay);
    expect(within(overlay).getByText('Final tier reached')).toBeInTheDocument();
    expect(within(overlay).getByText('Gold')).toBeInTheDocument();
  });

  it('closes the overlay on its button or Escape', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('tier_up', ['silver']));
    fireEvent.click(screen.getByTestId(testIds.achievements.overlayDismiss));
    expect(screen.queryByTestId(testIds.achievements.overlay)).not.toBeInTheDocument();

    await announce(response('tier_up', ['gold']));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId(testIds.achievements.overlay)).not.toBeInTheDocument();
  });

  it('dismisses a toast on its own after a few seconds', async () => {
    jest.useFakeTimers();
    try {
      render(<AchievementAnnouncementHost />);
      await act(async () => {
        await announceEvaluated(response('award', ['bronze']));
        await jest.runOnlyPendingTimersAsync();
      });
      expect(screen.getByTestId(testIds.achievements.toast('guides-finished'))).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(6000);
      });
      expect(screen.queryByTestId(testIds.achievements.toast('guides-finished'))).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a progress toast, worded like the hub, for an increment', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('increment', [], false, { units: 4, next: 5 }));
    const toast = screen.getByTestId(testIds.achievements.toast('guides-finished'));
    expect(within(toast).getByText('Achievement progress')).toBeInTheDocument();
    expect(within(toast).getByText('Guide finisher')).toBeInTheDocument();
    expect(within(toast).getByText('4 of 5 toward the next tier')).toBeInTheDocument();
    expect(within(toast).getByTestId('achievement-badge-image')).toHaveAttribute(
      'src',
      'https://interactive-learning.grafana.net/achievements/art/guides-finished-2.svg'
    );
    expect(screen.queryByTestId(testIds.achievements.overlay)).not.toBeInTheDocument();
  });

  it('replaces a showing progress toast when the achievement is then awarded', async () => {
    render(<AchievementAnnouncementHost />);
    await announce(response('increment', [], false, { units: 2, next: 5 }));
    await announce(response('award', ['bronze']));
    const toasts = screen.getAllByTestId(testIds.achievements.toast('guides-finished'));
    expect(toasts).toHaveLength(1);
    expect(within(toasts[0]!).getByText('Achievement earned')).toBeInTheDocument();
  });

  it('shows nothing when /definitions is unavailable', async () => {
    __setAchievementDisplayDepsForTests({ fetchDefinitions: async () => null });
    const { container } = render(<AchievementAnnouncementHost />);
    await announce(response('award', ['bronze']));
    expect(container).toBeEmptyDOMElement();
  });
});
