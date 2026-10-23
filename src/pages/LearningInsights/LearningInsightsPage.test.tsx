import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { OrgRole } from '@grafana/data';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { useLearningInsights } from '../../hooks/useLearningInsights';
import { getFeatureFlagValue } from '../../utils/openfeature';
import LearningInsightsPage, { LearningInsightsView } from './LearningInsightsPage';
import { completionTrend, defaultWindow, learningLink, personName } from './insights.helpers';

const originalObserver = global.IntersectionObserver;
beforeAll(() => {
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D);
});
afterAll(() => {
  global.IntersectionObserver = originalObserver;
  jest.restoreAllMocks();
});

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { orgRole: 'Admin', isGrafanaAdmin: false } } } }));
jest.mock('../../hooks/useLearningInsights', () => ({ useLearningInsights: jest.fn() }));
jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

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
  jest.mocked(getFeatureFlagValue).mockReturnValue(true);
  config.bootData.user.orgRole = OrgRole.Admin;
  config.bootData.user.isGrafanaAdmin = false;
  jest
    .mocked(useLearningInsights)
    .mockReturnValue({ data: fixture(), loading: false, error: null, refresh: jest.fn() });
});

test('does not mount the reporting hook for an admin when the rollout flag is off', () => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(false);
  render(<LearningInsightsPage />);
  expect(screen.getByText('Learning insights is not enabled for this stack.')).toBeInTheDocument();
  expect(useLearningInsights).not.toHaveBeenCalled();
  expect(getFeatureFlagValue).toHaveBeenCalledWith('pathfinder.learning-insights', false);
});

test('shows current assignment summary and accessible completion chart intervals', () => {
  renderView();
  expect(screen.getByText('Guide completions')).toBeInTheDocument();
  expect(screen.getByText(/1 complete · 1 outstanding · 1 need review/)).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Guide completions by interval' })).toBeInTheDocument();
  expect(screen.getAllByRole('listitem', { name: /guide completions/ })).toHaveLength(4);
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
  fireEvent.click(screen.getByRole('button', { name: 'metrics' }));
  const evidence = screen.getByRole('region', { name: 'metrics' });
  expect(within(evidence).getByRole('heading', { name: 'metrics' })).toHaveFocus();
  expect(within(evidence).getByRole('heading', { name: '1 of 2 guides completed' })).toBeInTheDocument();
  expect(within(evidence).getByText(/Due:/)).toHaveTextContent(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date('2026-07-20T00:00:00Z')
    )
  );
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
  fireEvent.click(within(evidence).getByRole('button', { name: 'Close assignment details' }));
  expect(screen.getByRole('button', { name: 'metrics' })).toHaveFocus();
});

test('filters content, persons and status and preserves unresolved evidence', async () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  expect(screen.queryByText('More filters')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'unknown' } });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'user:unmatched' }));
  fireEvent.click(screen.getByRole('button', { name: 'unresolved' }));
  expect(screen.getByText('Completion cannot be checked')).toBeInTheDocument();
  expect(screen.getByText('Cannot check')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open learning content/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
  const content = screen.getByRole('combobox', { name: 'Learning content' });
  fireEvent.click(content);
  fireEvent.change(content, { target: { value: 'dashboard' } });
  fireEvent.click(await screen.findByRole('option', { name: /Your first dashboard.*app-platform/ }));
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  fireEvent.keyDown(content, { key: 'Escape' });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'no-match' } });
  expect(screen.getByText('No assignments match these filters.')).toBeInTheDocument();
});

test('content search supports keyboard selection without losing reset to all content', async () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  const content = screen.getByRole('combobox', { name: 'Learning content' });
  expect(content).toHaveAttribute('placeholder', 'Search learning content');
  fireEvent.click(content);
  fireEvent.change(content, { target: { value: 'unresolved' } });
  await screen.findByRole('option', { name: /unresolved/ });
  fireEvent.keyDown(content, { key: 'ArrowDown' });
  fireEvent.keyDown(content, { key: 'Enter' });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'unresolved' })).toBeInTheDocument();
  fireEvent.keyDown(content, { key: 'Escape' });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(3);
});

test('people include older subjects without pretending they completed in this window', () => {
  renderView();
  fireEvent.click(screen.getByRole('button', { name: 'Assignments and people' }));
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'user:older' } });
  expect(screen.getByText(/Older evidence may still satisfy an assignment/)).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getAllByText('Complete')).toHaveLength(2);
});

test('partial completion reads show one notice without qualifying every metric label', () => {
  const data = fixture();
  data.completeness = 'partial';
  data.warnings = ['completions-page-limit'];
  renderView(data);
  expect(screen.getByText(/Completion records could not all be loaded/)).toBeInTheDocument();
  expect(screen.getByText('Guide completions')).toBeInTheDocument();
  expect(screen.getByText('People completing')).toBeInTheDocument();
  expect(screen.getByText('People per guide in this period')).toBeInTheDocument();
  expect(screen.queryByText(/available (guide )?records/i)).not.toBeInTheDocument();
  expect(screen.queryByText('completions-page-limit')).not.toBeInTheDocument();
  expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
});

test.each([
  [{ loading: true }, 'Loading learning records…'],
  [{ error: 'Permission denied' }, 'Learning insights could not be loaded'],
])('does not present cached numbers as current during loading or error', (state, message) => {
  renderView(fixture(), state);
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.queryByText('Guide completions')).not.toBeInTheDocument();
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

test('server-admin flag does not substitute for the current-org role', () => {
  config.bootData.user.orgRole = OrgRole.Viewer;
  config.bootData.user.isGrafanaAdmin = true;
  render(<LearningInsightsPage />);
  expect(useLearningInsights).not.toHaveBeenCalled();
});

test('native time picker requests complete UTC days and native refresh remains actionable', () => {
  render(<LearningInsightsPage />);
  fireEvent.click(screen.getByRole('button', { name: /Time range selected/ }));
  fireEvent.click(screen.getByText('Last 7 complete days'));
  const args = jest.mocked(useLearningInsights).mock.calls.at(-1)!;
  expect(Date.parse(args[1]!) - Date.parse(args[0]!)).toBe(7 * 86400000);
  expect(args[0]).toMatch(/T00:00:00.000Z$/);
  fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
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
