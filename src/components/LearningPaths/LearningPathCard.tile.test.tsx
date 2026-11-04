import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LearningPathCard } from './LearningPathCard';

it('opens the tile overview, keeps radial progress, and has no competing start action', () => {
  const view = jest.fn();
  const launch = jest.fn();
  render(
    <LearningPathCard
      tile
      path={{
        id: 'test-path',
        title: 'Test path',
        description: 'A path description',
        guides: ['one', 'two'],
        badgeId: '',
      }}
      guides={[
        { id: 'one', title: 'First', completed: true, isCurrent: false },
        { id: 'two', title: 'Second', completed: false, isCurrent: true },
      ]}
      progress={50}
      isCompleted={false}
      onContinue={launch}
      onViewPath={view}
    />
  );
  expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByText(/1\/2 guides/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Start|Continue|View path/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('A path description'));
  expect(view).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Test path' }));
  expect(view).toHaveBeenCalledTimes(2);
  expect(launch).not.toHaveBeenCalled();
});

it('opens the course from its inset preview and replaces the icon tile with a category eyebrow', () => {
  const view = jest.fn();
  const { container } = render(
    <LearningPathCard
      tile
      path={{ id: 'preview', title: 'Preview path', description: 'Preview course', guides: [], badgeId: '' }}
      guides={[]}
      progress={25}
      isCompleted={false}
      onContinue={jest.fn()}
      onViewPath={view}
      topic="logs"
      preview={{ src: 'test-preview.png', alt: 'Collected logs in Grafana' }}
    />
  );
  expect(screen.getByText('Logs')).toBeInTheDocument();
  expect(container.querySelector('[data-learning-topic-icon]')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('img', { name: 'Collected logs in Grafana' }));
  expect(view).toHaveBeenCalledTimes(1);
});
