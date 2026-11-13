import React from 'react';
import { createTheme } from '@grafana/data';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { learningProgressStorage } from '../lib/user-storage';
import { HomeBadgesSummary } from '../components/LearningPaths/sections/HomeBadgesSummary';
import { getMyLearningStyles } from '../components/LearningPaths/MyLearningTab.styles';
import { awardBadge, markGuideCompleted } from './badge-coordinator';
import { useLearningPaths } from './learning-paths.hook';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { settings: { cloudMigrationIsTarget: false }, user: { id: 1, orgId: 1 } } },
  getAppEvents: () => ({ publish: jest.fn() }),
}));
jest.mock('@grafana/i18n', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { BadgeUnlocked: 'badge-unlocked' },
}));

function BadgeShelf() {
  const { badgesWithStatus, progress, paths, isLoading } = useLearningPaths();
  if (isLoading) {
    return <p>Loading progress</p>;
  }
  return (
    <HomeBadgesSummary
      badges={badgesWithStatus}
      badgeProgress={new Map()}
      completedGuides={progress.completedGuides}
      streakDays={progress.streakDays}
      paths={paths}
      onSelect={jest.fn()}
      styles={getMyLearningStyles(createTheme(), true)}
    />
  );
}

it('updates a mounted Home badge shelf after a course badge is saved without remounting', async () => {
  localStorage.clear();
  await learningProgressStorage.update({
    completedGuides: [],
    earnedBadges: [],
    pendingCelebrations: [],
    streakDays: 0,
    lastActivityDate: '',
  });
  render(<BadgeShelf />, { wrapper: MemoryRouter });
  expect(await screen.findByRole('heading', { name: 'You’ve unlocked 0 badges' })).toBeInTheDocument();

  await act(async () => {
    expect(await awardBadge('grafana-fundamentals')).toBe(true);
  });

  expect(await screen.findByRole('heading', { name: 'You’ve unlocked 1 badge' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Grafana Fundamentals' })).toBeInTheDocument();
  expect((await learningProgressStorage.get()).earnedBadges).toEqual([
    { id: 'grafana-fundamentals', earnedAt: expect.any(Number) },
  ]);
});

it('shows the first earned badge on a mounted Home shelf starting with empty storage', async () => {
  localStorage.clear();
  render(<BadgeShelf />, { wrapper: MemoryRouter });
  expect(await screen.findByRole('heading', { name: 'You’ve unlocked 0 badges' })).toBeInTheDocument();

  await act(async () => {
    await markGuideCompleted('welcome-to-grafana');
  });

  expect(await screen.findByRole('heading', { name: 'You’ve unlocked 1 badge' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'First steps' })).toBeInTheDocument();
});
