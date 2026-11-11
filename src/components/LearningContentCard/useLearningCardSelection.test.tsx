import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { reportPathfinderSurface } from '../../lib/telemetry/surface';
import { LearningContentCard } from './LearningContentCard';
import { useLearningCardSelection } from './useLearningCardSelection';

function Cards({ scope = 'test' }: { scope?: string }) {
  const { selectedCardKey, selectCard } = useLearningCardSelection(scope);
  return (
    <>
      {['First guide', 'Second guide'].map((title) => (
        <LearningContentCard
          key={title}
          tile
          kind="guide"
          title={title}
          selected={selectedCardKey === title}
          onViewPath={() => selectCard(title)}
          onLaunch={jest.fn()}
        />
      ))}
    </>
  );
}

it('keeps a card selected after focus leaves, transfers selection, and clears it when the panel closes', () => {
  reportPathfinderSurface('sidebar');
  render(<Cards />);
  const first = screen.getByRole('button', { name: 'First guide' });
  const second = screen.getByRole('button', { name: 'Second guide' });
  fireEvent.click(first.closest('article')!);
  fireEvent.blur(first);
  expect(first).toHaveAttribute('aria-current', 'true');
  fireEvent.click(second);
  expect(first).not.toHaveAttribute('aria-current');
  expect(second).toHaveAttribute('aria-current', 'true');
  act(() => reportPathfinderSurface('closed'));
  expect(second).not.toHaveAttribute('aria-current');
});

it('does not carry card selection into another catalogue scope', () => {
  const { rerender } = render(<Cards />);
  fireEvent.click(screen.getByRole('button', { name: 'First guide' }));
  rerender(<Cards scope="another-organization" />);
  expect(screen.getByRole('button', { name: 'First guide' })).not.toHaveAttribute('aria-current');
});
