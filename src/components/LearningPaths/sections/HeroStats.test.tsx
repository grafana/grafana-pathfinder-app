/**
 * Tests for the hero stat row: badges earned reads as a single earned count,
 * not an earned/total fraction (issue #1462).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { HeroStats } from './HeroStats';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const styles = new Proxy({}, { get: (_t, prop) => String(prop) }) as ReturnType<typeof getMyLearningStyles>;

describe('HeroStats', () => {
  it('shows badges earned as a single number', () => {
    render(<HeroStats guidesCompleted={4} badgesEarned={2} streakDays={3} styles={styles} />);

    const badgesStat = screen.getByText('Badges earned').parentElement!;
    expect(badgesStat).toHaveTextContent(/^2Badges earned$/);
  });

  it('gives the badge count its own accent treatment, distinct from guides completed', () => {
    render(<HeroStats guidesCompleted={4} badgesEarned={2} streakDays={3} styles={styles} />);

    expect(screen.getByText('2')).toHaveClass('statValueBadges');
    expect(screen.getByText('4')).toHaveClass('statValue');
  });
});
