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

it('opens the course from its inset preview with a duration badge and category eyebrow', () => {
  const view = jest.fn();
  const { container } = render(
    <LearningPathCard
      tile
      path={{
        id: 'preview',
        title: 'Preview path',
        description: 'Preview course',
        guides: [],
        badgeId: '',
        estimatedMinutes: 20,
      }}
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
  expect(screen.getAllByText('20 min')).toHaveLength(1);
  expect(screen.queryByText('About 20 min')).not.toBeInTheDocument();
  expect(container.querySelector('[data-learning-topic-icon]')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('img', { name: 'Collected logs in Grafana' }));
  expect(view).toHaveBeenCalledTimes(1);
});

it('features the next guide without repeating the full outline and resumes through the existing overview', () => {
  const view = jest.fn();
  render(
    <LearningPathCard
      tile
      presentation="resume"
      path={{ id: 'active', title: 'Active course', description: 'A course', guides: ['one', 'two'], badgeId: '' }}
      guides={[
        { id: 'one', title: 'Completed lesson', completed: true, isCurrent: false },
        {
          id: 'two',
          title: 'Next lesson',
          description: 'Learn what to do in the next lesson.',
          completed: false,
          isCurrent: true,
        },
      ]}
      progress={50}
      isCompleted={false}
      onContinue={jest.fn()}
      onViewPath={view}
    />
  );
  expect(screen.getByText('Next lesson')).toBeInTheDocument();
  expect(screen.queryByText('A course')).not.toBeInTheDocument();
  expect(screen.getByText('Learn what to do in the next lesson.')).toBeInTheDocument();
  expect(screen.queryByText('Completed lesson')).not.toBeInTheDocument();
  expect(screen.getByText('2 guides')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume' }).closest('[data-learning-card-footer]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(view).toHaveBeenCalledTimes(1);
});

it('keeps a clickable image preview and progress on a compact resume card without its description', () => {
  const view = jest.fn();
  render(
    <LearningPathCard
      tile
      presentation="compact"
      path={{
        id: 'compact',
        title: 'Compact path',
        description: 'Full path description',
        guides: ['one', 'two'],
        badgeId: '',
      }}
      guides={[
        { id: 'one', title: 'First lesson', completed: true, isCurrent: false },
        { id: 'two', title: 'Next lesson', completed: false, isCurrent: true },
      ]}
      progress={50}
      isCompleted={false}
      onContinue={jest.fn()}
      onViewPath={view}
      preview={{ src: 'test-preview.png', alt: 'Linux dashboard' }}
    />
  );
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.queryByText('Full path description')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('img', { name: 'Linux dashboard' }));
  expect(view).toHaveBeenCalledTimes(1);
});
