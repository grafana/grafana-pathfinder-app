import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { LearningInsightsView } from './LearningInsightsPage';

beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
});
afterAll(() => jest.restoreAllMocks());

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));

const fixture = (): LearningInsightsResponse => ({
  asOf: '2026-07-29T12:00:00Z',
  from: '2026-07-01T00:00:00Z',
  to: '2026-07-29T00:00:00Z',
  capability: { available: true },
  completeness: 'complete',
  warnings: [],
  people: [
    { userId: 'a', userDisplayName: 'Alex', userLogin: 'alex' },
    { userId: 'b', userDisplayName: 'Blair', userLogin: 'blair' },
  ],
  completions: [
    {
      userId: 'a',
      guideId: 'guide',
      guideSource: 'bundled',
      guideTitle: 'First dashboard',
      completedAt: '2026-07-03T09:00:00Z',
      source: 'objectives',
    },
  ],
  assignments: ['a', 'b'].map((userId) => ({
    name: userId,
    userId,
    targetType: 'guide',
    targetId: 'guide',
    targetSource: 'bundled',
    trackId: '',
    ruleId: '',
    assignedAt: '2026-07-01T00:00:00Z',
    dueAt: '',
    status: 'complete',
    reason: '',
    guides: [{ guideId: 'guide', guideSource: 'bundled', completed: true }],
  })),
});
const show = (data = fixture()) => render(<LearningInsightsView data={data} refresh={jest.fn()} />);

test('compact overview has no marketing hero, raw window or diagnostic dump', () => {
  show();
  expect(
    screen.queryByText(/Learning, made visible|Completion window|Snapshot as of|View trend data/)
  ).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Guide completions over time' })).toBeInTheDocument();
  expect(screen.queryByText(/Dates and times shown/)).not.toBeInTheDocument();
  expect(screen.queryByText(/objectives/)).not.toBeInTheDocument();
  expect(screen.getByText('Steps completed')).toBeInTheDocument();
  const timestamp = screen.getByText(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date('2026-07-03T09:00:00Z')
    )
  );
  expect(timestamp).toHaveAttribute('dateTime', '2026-07-03T09:00:00Z');
  expect(timestamp).toHaveAttribute('title');
});

test('sparse completion data with no assignments has a useful empty state, not a zero ring', () => {
  show({ ...fixture(), assignments: [] });
  expect(screen.getByText('No assignments yet')).toBeInTheDocument();
  expect(screen.queryByText(/0 \/ 0|At least|0 overdue assignments|0 unknown statuses/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent completions' })).toBeInTheDocument();
});

test('journey ambiguity scopes the notice to completions and does not taint exact assignment zeros', () => {
  show({ ...fixture(), assignments: [], completeness: 'partial', warnings: ['journey-identity-ambiguous'] });
  expect(screen.queryByText('About completion counts')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('No assignments yet')).toBeInTheDocument();
  expect(screen.queryByText(/journey-identity-ambiguous|At least/)).not.toBeInTheDocument();
});

test('failed assignment loads do not report no assignments or all clear', () => {
  show({ ...fixture(), assignments: [], completeness: 'partial', warnings: ['assignments-fetch-failed'] });
  expect(screen.getByText(/Assignment records could not all be loaded/)).toBeInTheDocument();
  expect(screen.queryByText(/No assignments yet|No assignments need attention/)).not.toBeInTheDocument();
  expect(screen.getByText('Assignment summary unavailable')).toBeInTheDocument();
  expect(screen.getByText('Guide completions')).toBeInTheDocument();
  expect(screen.queryByText('Guide completions · available records')).not.toBeInTheDocument();
});

test('all people includes completion-only people when there are no assignments', () => {
  show({ ...fixture(), assignments: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.getByLabelText('Person')).toHaveDisplayValue('All people');
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Alex' }));
  expect(screen.getByRole('complementary')).toBeInTheDocument();
  expect(within(screen.getByRole('complementary')).getByText('First dashboard', { exact: false })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Inspect Alex' })).toBeInTheDocument();
});

test('true zero attention is calm but unknown statuses require follow-up', () => {
  const { unmount } = show();
  expect(screen.getByText('No assignments need attention')).toBeInTheDocument();
  unmount();
  const data = fixture();
  data.assignments[0] = { ...data.assignments[0]!, status: 'unknown', guides: [], reason: 'target-unresolved' };
  show(data);
  expect(screen.queryByText('No assignments need attention')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Review unresolved assignments/ })).toBeInTheDocument();
});

test('all people defaults to actual people and assignment views, filters and restores all rows', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.getByLabelText('Person')).toHaveDisplayValue('All people');
  const assignmentTable = () => screen.getByRole('table', { name: /assignments/i });
  expect(within(assignmentTable()).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'a' } });
  expect(within(assignmentTable()).getAllByRole('row')).toHaveLength(2);
  expect(screen.getByRole('complementary')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: '' } });
  expect(within(assignmentTable()).getAllByRole('row')).toHaveLength(3);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});
