import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@grafana/data';

import type { EarnedBadge } from '../../../types';
import { getMyLearningStyles } from '../MyLearningTab.styles';
import { HomeBadgesSummary } from './HomeBadgesSummary';

it('shows every earned badge without dates, omits badges without progress, and opens a selected badge', () => {
  const earned: EarnedBadge = {
    id: 'first-steps',
    title: 'First steps',
    description: 'Complete a guide',
    icon: 'rocket',
    trigger: { type: 'guide-completed' },
    earnedAt: Date.UTC(2026, 9, 30, 12),
  };
  const working: EarnedBadge = {
    id: 'penguin-wrangler',
    title: 'Penguin Wrangler',
    description: 'Complete the Linux path',
    icon: 'rocket',
    trigger: { type: 'path-completed', pathId: 'linux-server-integration' },
  };
  const additionalEarned = [1, 2, 3].map((index) => ({
    ...earned,
    id: `earned-${index}`,
    title: `Earned badge ${index}`,
  }));
  const untouched: EarnedBadge = {
    id: 'grafana-fundamentals',
    title: 'Grafana Fundamentals',
    description: 'Complete fundamentals',
    icon: 'grafana',
    trigger: { type: 'path-completed', pathId: 'getting-started' },
  };
  const select = jest.fn();
  render(
    <HomeBadgesSummary
      badges={[earned, ...additionalEarned, working, untouched]}
      badgeProgress={new Map()}
      completedGuides={[]}
      streakDays={0}
      paths={[]}
      onSelect={select}
      styles={getMyLearningStyles(createTheme(), true)}
    />
  );
  expect(screen.queryByText(/^Earned Oct/)).not.toBeInTheDocument();
  expect(screen.queryByText('First steps')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(4);
  expect(screen.getByRole('heading', { name: 'You’ve unlocked 4 badges' })).toBeInTheDocument();
  for (const badge of additionalEarned) {
    expect(screen.getByRole('button', { name: badge.title })).toBeInTheDocument();
  }
  expect(screen.queryByText('Penguin Wrangler')).not.toBeInTheDocument();
  expect(screen.queryByText('Grafana Fundamentals')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Show all badges' })).toHaveAttribute(
    'href',
    expect.stringContaining('/badges')
  );
  fireEvent.click(screen.getByRole('button', { name: /First steps/ }));
  expect(select).toHaveBeenCalledWith(earned);
});

it('shows only the unearned badge with the most actual progress and opens its details', () => {
  const working: EarnedBadge = {
    id: 'penguin-wrangler',
    title: 'Penguin Wrangler',
    description: 'Complete the Linux path',
    icon: 'rocket',
    trigger: { type: 'path-completed', pathId: 'linux-server-integration' },
  };
  const partial: EarnedBadge = { ...working, id: 'partial', title: 'Less progress' };
  const untouched: EarnedBadge = { ...working, id: 'untouched', title: 'Not started' };
  const legacy: EarnedBadge = { ...working, id: 'legacy', title: 'Legacy', isLegacy: true };
  const complete: EarnedBadge = { ...working, id: 'complete', title: 'Fully complete' };
  const select = jest.fn();
  render(
    <HomeBadgesSummary
      badges={[partial, legacy, complete, working, untouched]}
      badgeProgress={
        new Map([
          ['penguin-wrangler', { current: 3, total: 6, label: 'guides in path', percentage: 50 }],
          ['partial', { current: 1, total: 6, label: 'guides in path', percentage: 17 }],
          ['legacy', { current: 5, total: 6, label: 'guides in path', percentage: 83 }],
          ['complete', { current: 6, total: 6, label: 'guides in path', percentage: 100 }],
          ['untouched', { current: 0, total: 6, label: 'guides in path', percentage: 0 }],
        ])
      }
      completedGuides={[]}
      streakDays={0}
      paths={[]}
      onSelect={select}
      styles={getMyLearningStyles(createTheme(), true)}
    />
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByText('3/6')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Penguin Wrangler/ }));
  expect(select).toHaveBeenCalledWith(working);
});

it('uses actual streak progress in the encouragement prompt and hides it when progress is absent', () => {
  const badge: EarnedBadge = {
    id: 'consistent-learner',
    title: 'Consistent Learner',
    description: 'Maintain a 3-day learning streak',
    icon: 'fire',
    trigger: { type: 'streak', days: 3 },
  };
  const props = {
    badges: [badge],
    completedGuides: [],
    streakDays: 1,
    paths: [],
    onSelect: jest.fn(),
    styles: getMyLearningStyles(createTheme(), true),
  };
  const { rerender } = render(
    <HomeBadgesSummary
      {...props}
      badgeProgress={new Map([[badge.id, { current: 1, total: 3, label: 'day streak', percentage: 33 }]])}
    />
  );
  expect(screen.getByRole('button', { name: /You’ve almost unlocked Consistent Learner/ })).toBeInTheDocument();
  expect(screen.getByText('1/3')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: badge.title })).toHaveAttribute('aria-valuenow', '1');
  rerender(<HomeBadgesSummary {...props} badgeProgress={new Map()} />);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByText(/You’ve almost unlocked/)).not.toBeInTheDocument();
});
