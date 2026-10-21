import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { OrgRole } from '@grafana/data';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { useLearningInsights } from '../../hooks/useLearningInsights';
import LearningInsightsPage, { LearningInsightsView } from './LearningInsightsPage';
import { completionTrend, defaultWindow, learningLink, personName } from './insights.helpers';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin', isGrafanaAdmin: false } } } }));
jest.mock('../../hooks/useLearningInsights', () => ({ useLearningInsights: jest.fn() }));

const fixture = (): LearningInsightsResponse => ({
  asOf: '2026-07-29T12:00:00Z',
  from: '2026-07-01T00:00:00Z',
  to: '2026-07-29T00:00:00Z',
  capability: { available: true },
  completeness: 'complete',
  warnings: [],
  people: [
    { userId: 'user:alex', userDisplayName: 'Alex Morgan', userLogin: 'alex' },
    { userId: 'user:unmatched', userDisplayName: '', userLogin: '' },
    { userId: 'user:older', userDisplayName: 'Older evidence only', userLogin: '' },
  ],
  completions: [
    {
      userId: 'user:alex',
      guideId: 'dashboard',
      guideSource: 'bundled',
      guideTitle: 'Your first dashboard',
      completedAt: '2026-07-03T09:00:00Z',
      source: 'manual',
    },
    {
      userId: 'user:unmatched',
      guideId: 'dashboard',
      guideSource: 'app-platform',
      guideTitle: 'Your first dashboard',
      completedAt: '2026-07-26T09:00:00Z',
      source: 'objectives',
    },
  ],
  assignments: [
    {
      name: 'a1',
      userId: 'user:alex',
      targetType: 'path',
      targetSource: 'app-platform',
      targetId: 'metrics',
      trackId: 'builder',
      ruleId: 'onboarding',
      assignedAt: '2026-06-01T00:00:00Z',
      dueAt: '2026-07-20T00:00:00Z',
      status: 'overdue',
      reason: '',
      guides: [
        { guideSource: 'bundled', guideId: 'dashboard', completed: true },
        { guideSource: 'app-platform', guideId: 'explore', completed: false },
      ],
    },
    {
      name: 'a2',
      userId: 'user:unmatched',
      targetType: 'path',
      targetSource: 'online-cdn',
      targetId: 'unresolved',
      trackId: '',
      ruleId: 'other-wave',
      assignedAt: '2026-06-01T00:00:00Z',
      dueAt: '',
      status: 'unknown',
      reason: 'target-unavailable',
      guides: [],
    },
    {
      name: 'a3',
      userId: 'user:older',
      targetType: 'guide',
      targetSource: 'app-platform',
      targetId: 'dashboard',
      trackId: '',
      ruleId: 'onboarding',
      assignedAt: '2026-06-01T00:00:00Z',
      dueAt: '',
      status: 'complete',
      reason: '',
      guides: [{ guideSource: 'app-platform', guideId: 'dashboard', completed: true }],
    },
  ],
});

function renderView(data = fixture(), extra = {}) {
  return render(<LearningInsightsView data={data} refresh={jest.fn()} {...extra} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  config.bootData.user.orgRole = OrgRole.Admin;
  config.bootData.user.isGrafanaAdmin = false;
  jest
    .mocked(useLearningInsights)
    .mockReturnValue({ data: fixture(), loading: false, error: null, refresh: jest.fn() });
});

test('shows exact exclusive UTC window, current assignment summary and accessible chart data', () => {
  renderView();
  expect(screen.getAllByText(/2026-07-29 00:00:00 UTC/).length).toBeGreaterThan(0);
  expect(screen.getByText(/\(exclusive\)/)).toBeInTheDocument();
  expect(screen.getByText('Guide completions')).toBeInTheDocument();
  expect(screen.getByText('1 unknown')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: /Guide completions by interval/ })).toBeInTheDocument();
  expect(screen.getAllByText('Your first dashboard').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('button', { name: 'user:unmatched' })).toBeInTheDocument();
});

test('filters source-qualified content without merging identical titles', () => {
  renderView();
  fireEvent.change(screen.getByLabelText('Content'), {
    target: { value: JSON.stringify(['app-platform', 'dashboard']) },
  });
  expect(screen.queryByRole('button', { name: 'Alex Morgan' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'user:unmatched' })).toBeInTheDocument();
});

test('opens overdue obligations and contextual evidence with learning-only links', async () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Review overdue assignments →' }));
  expect(screen.getByLabelText('Status')).toHaveValue('overdue');
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Alex Morgan' }));
  const evidence = screen.getByRole('complementary');
  expect(within(evidence).getByRole('heading', { name: 'Alex Morgan' })).toHaveFocus();
  expect(within(evidence).getByRole('heading', { name: '1 of 2 guides credited' })).toBeInTheDocument();
  expect(within(evidence).getByText(/2026-07-20 00:00:00 UTC/)).toBeInTheDocument();
  const link = within(evidence).getByRole('link', { name: /Open learning content/ });
  const url = new URL(link.getAttribute('href')!);
  expect(url.pathname).toBe('/a/grafana-pathfinder-app');
  expect(url.searchParams.get('doc')).toBe('backend-guide:metrics');
  expect(url.searchParams.get('type')).toBe('learning-journey');
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  fireEvent.click(within(evidence).getByRole('button', { name: 'Copy learning link' }));
  expect(writeText).toHaveBeenCalledWith(url.toString());
  expect(await screen.findByText('Learning link copied.')).toBeInTheDocument();
  fireEvent.click(within(evidence).getByRole('button', { name: 'Close details' }));
  expect(screen.getByLabelText('Recorded person')).toHaveFocus();
});

test('filters rules, targets, persons and status and preserves unknown evidence', () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  fireEvent.change(screen.getByLabelText('Wave or rule'), { target: { value: 'other-wave' } });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'user:unmatched' }));
  expect(screen.getByText('Required-guide evidence is unresolved')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open learning content/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Wave or rule'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Target'), {
    target: { value: JSON.stringify(['guide', 'app-platform', 'dashboard']) },
  });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'no-match' } });
  expect(screen.getByText('No assignments match these filters.')).toBeInTheDocument();
});

test('people include older subjects without pretending they completed in this window', () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  fireEvent.change(screen.getByLabelText('Recorded person'), { target: { value: 'user:older' } });
  expect(screen.getByText(/Older evidence may still satisfy an assignment/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '1 of 1 guides credited' })).toBeInTheDocument();
});

test('partial results describe lower bounds and preserve warnings', () => {
  const data = fixture();
  data.completeness = 'partial';
  data.warnings = ['completion-page-budget'];
  renderView(data);
  expect(screen.getByText(/counts are lower bounds/)).toBeInTheDocument();
  expect(screen.getByText(/ranking of returned records only/)).toBeInTheDocument();
  expect(screen.getByText('completion-page-budget')).toBeInTheDocument();
  expect(screen.getAllByText('At least 2').length).toBeGreaterThan(0);
});

test.each([
  [{ loading: true }, 'Loading learning records…'],
  [{ error: 'Permission denied' }, 'Learning insights could not be loaded'],
])('does not present cached numbers as current during loading or error', (state, message) => {
  renderView(fixture(), state);
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.queryByText('Learning, made visible.')).not.toBeInTheDocument();
});

test('unavailable is not an empty stack with zero totals', () => {
  const data = fixture();
  data.capability = { available: false, reason: 'missing-identity' };
  renderView(data);
  expect(screen.getByText('Learning insights is unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Guide completions')).not.toBeInTheDocument();
});

test('empty stack is honest about record-based people', () => {
  renderView({ ...fixture(), people: [], completions: [], assignments: [] });
  expect(screen.getByText(/No learning records returned/)).toBeInTheDocument();
  expect(screen.getByText('No guide completions recorded in this period.')).toBeInTheDocument();
});

test('browser role gate avoids reporting fetch for a nonadmin', () => {
  config.bootData.user.orgRole = OrgRole.Viewer;
  render(<LearningInsightsPage />);
  expect(screen.getByText(/Switch to an organization you administer/)).toBeInTheDocument();
  expect(useLearningInsights).not.toHaveBeenCalled();
});

test('period selector requests complete UTC days and refresh remains actionable', () => {
  render(<LearningInsightsPage />);
  fireEvent.change(screen.getByLabelText('Completion period'), { target: { value: '7' } });
  const args = jest.mocked(useLearningInsights).mock.calls.at(-1)!;
  expect(Date.parse(args[1]!) - Date.parse(args[0]!)).toBe(7 * 86400000);
  expect(args[0]).toMatch(/T00:00:00.000Z$/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(jest.mocked(useLearningInsights).mock.results.at(-1)!.value.refresh).toHaveBeenCalled();
});

test('helpers respect period boundaries and do not fabricate unsupported content links', () => {
  expect(defaultWindow(28, new Date('2026-07-29T23:00:00Z'))).toEqual({
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-29T00:00:00.000Z',
  });
  const row = fixture().completions[0]!;
  const trend = completionTrend(
    [
      { ...row, completedAt: '2026-07-01T00:00:00Z' },
      { ...row, completedAt: '2026-07-29T00:00:00Z' },
    ],
    fixture().from,
    fixture().to
  );
  expect(trend.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
  expect(personName(undefined, 'stable-subject')).toBe('stable-subject');
  expect(learningLink('online-cdn', 'id', 'guide')).toBeNull();
  expect(learningLink('javascript:', 'evil', 'guide')).toBeNull();
  expect(learningLink('bundled', 'dashboard', 'guide')).toContain('doc=bundled%3Adashboard%2Fcontent.json');
});
