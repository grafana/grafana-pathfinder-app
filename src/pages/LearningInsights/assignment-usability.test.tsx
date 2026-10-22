import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import fixture from '../../../pkg/plugin/testdata/contract/learning-insights.default.json';
import type { LearningInsightsAssignment, LearningInsightsResponse } from '../../types/learning-insights';
import { LearningInsightsView } from './LearningInsightsPage';

beforeAll(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
});
afterAll(() => jest.restoreAllMocks());

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin' } } } }));

function show(overrides: Partial<LearningInsightsAssignment> = {}) {
  const data = { ...fixture } as LearningInsightsResponse;
  const guide = data.completions[0]!;
  const base = {
    ...data.assignments[0]!,
    targetType: 'guide',
    targetId: guide.guideId,
    targetSource: guide.guideSource,
    guides: [{ guideId: guide.guideId, guideSource: guide.guideSource, completed: false }],
    ...overrides,
  };
  data.assignments = [
    base,
    {
      ...base,
      name: 'second-assignment',
      ruleId: 'different-rule',
      status: 'complete',
      guides: [{ ...base.guides[0]!, completed: true }],
    },
  ];
  render(<LearningInsightsView data={data} refresh={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: base.userId } });
  return { data, guide, table: screen.getByRole('table') };
}

test('selected people have one full-width table, no duplicate cards or redundant person controls', () => {
  const { table } = show();
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((node) => node.textContent)
  ).toEqual(['Learning content', 'Completion', 'Status', 'Due (UTC)']);
  expect(screen.queryByLabelText('Find a person')).not.toBeInTheDocument();
  expect(screen.queryByText('Guides credited')).not.toBeInTheDocument();
  expect(screen.queryByText('Target / rule')).not.toBeInTheDocument();
  expect(screen.queryByText('Open learning content →')).not.toBeInTheDocument();
  expect(screen.queryByText('More filters')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Rule ID')).not.toBeInTheDocument();
  expect(screen.getByText(/Completion history in selected period/).closest('details')).not.toHaveAttribute('open');
  expect(within(table).queryByRole('progressbar')).not.toBeInTheDocument();
});

test('assignments and people are separate sections with a consistent gap', () => {
  show();
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: '' } });
  const people = screen.getByRole('region', { name: 'People' });
  expect(getComputedStyle(people.parentElement!).gap).toBe('24px');
  expect(screen.queryByText('About completion counts')).not.toBeInTheDocument();
  expect(screen.queryByText('More filters')).not.toBeInTheDocument();
});

test('opens exactly one assignment, keeps technical identifiers collapsed, and restores focus on close', () => {
  const { table, guide } = show();
  const trigger = within(table).getAllByRole('button', { name: guide.guideTitle })[0]!;
  fireEvent.click(trigger);
  const details = screen.getByRole('region', { name: guide.guideTitle });
  expect(within(details).getByRole('heading', { name: guide.guideTitle })).toHaveFocus();
  expect(screen.getAllByRole('link', { name: /Open learning content/ })).toHaveLength(1);
  expect(within(details).getByText('Technical details').closest('details')).not.toHaveAttribute('open');
  expect(within(details).getByText('How completion is counted').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(within(details).getByRole('button', { name: 'Close assignment details' }));
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('link', { name: /Open learning content/ })).not.toBeInTheDocument();
});

test.each([
  ['target-unresolved', /could not be found/],
  ['target-fetch-failed', /could not be loaded/],
  ['completion-history-incomplete', /could not be fully loaded/],
  ['lifecycle-unsupported', /unsupported state/],
])('explains needs-review status in a keyboard-accessible tooltip for %s', async (reason, message) => {
  const { table } = show({ status: 'unknown', guides: [], reason });
  expect(within(table).getByText('Needs review')).toBeInTheDocument();
  expect(within(table).getByText('Cannot check')).toBeInTheDocument();
  const trigger = within(table).getByRole('button', { name: 'Why this assignment needs review' });
  expect(trigger.closest('details')).toBeNull();
  fireEvent.focus(trigger);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(message);
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(within(table).queryByText('Unknown')).not.toBeInTheDocument();
});

test('content titles are matched by source as well as guide ID', () => {
  const { table, guide } = show({ targetSource: 'other-source' });
  expect(within(table).queryByRole('button', { name: guide.guideTitle })).not.toBeInTheDocument();
  expect(within(table).getAllByRole('button', { name: guide.guideId })).toHaveLength(2);
});

test('withdrawn assignments do not show a spurious unknown completion', () => {
  const { table } = show({ status: 'withdrawn', guides: [] });
  const row = within(table).getByText('Withdrawn').closest('tr')!;
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
  expect(within(row).queryByText('Unknown')).not.toBeInTheDocument();
});

test('an incomplete check retains positive completion evidence without implying a complete assessment', () => {
  const { table } = show({
    status: 'unknown',
    reason: 'completion-history-incomplete',
    guides: [
      { guideId: 'known', guideSource: 'bundled', completed: true },
      { guideId: 'other', guideSource: 'bundled', completed: false },
    ],
  });
  expect(within(table).getByText('1 completed · check incomplete')).toBeInTheDocument();
});
