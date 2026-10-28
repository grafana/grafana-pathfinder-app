import { config } from '@grafana/runtime';
import type { LearningInsightsCompletion, LearningInsightsResponse } from '../../types/learning-insights';
import { assignmentTitle, guideTitle, learningLink } from './insights.helpers';
import fixture from '../../../pkg/plugin/testdata/contract/learning-insights.default.json';

jest.mock('@grafana/runtime', () => ({ config: { appSubUrl: '' } }));

const assignment = (fixture as LearningInsightsResponse).assignments[0]!;

const completion = (source: string, title = 'Recorded online title'): LearningInsightsCompletion => ({
  userId: 'user:learner',
  guideId: 'same-slug',
  guideSource: source,
  guideTitle: title,
  completedAt: '2026-07-03T09:00:00Z',
  source: 'manual',
});

beforeEach(() => {
  config.appSubUrl = '';
});

test.each(['bundled', 'app-platform'])('learning links retain the Grafana subpath for %s', (source) => {
  config.appSubUrl = '/grafana';
  const link = new URL(learningLink(source, 'example', 'guide', 'https://example.com')!);
  expect(link.origin).toBe('https://example.com');
  expect(link.pathname).toBe('/grafana/a/grafana-pathfinder-app');
  expect(link.searchParams.get('doc')).toBe(
    source === 'bundled' ? 'bundled:example/content.json' : 'backend-guide:example'
  );
});

test('root-hosted learning links retain the plugin base path and encoded content identity', () => {
  const link = new URL(learningLink('app-platform', 'name with spaces&value', 'path', 'https://example.com')!);
  expect(link.pathname).toBe('/a/grafana-pathfinder-app');
  expect(link.searchParams.get('doc')).toBe('backend-guide:name with spaces&value');
  expect(link.searchParams.get('type')).toBe('learning-journey');
});

test.each([
  ['online-cdn', 'interactive-tutorials'],
  ['interactive-tutorials', 'online-cdn'],
])('guide titles recognize the supported online alias %s -> %s', (target, recorded) => {
  const rows = [completion(recorded)];
  expect(guideTitle(target, 'same-slug', rows)).toBe('Recorded online title');
  expect(
    assignmentTitle({ ...assignment, targetType: 'guide', targetSource: target, targetId: 'same-slug' }, rows)
  ).toBe('Recorded online title');
});

test('an exact source-qualified title wins over an online alias', () => {
  expect(
    guideTitle('online-cdn', 'same-slug', [
      completion('interactive-tutorials'),
      completion('online-cdn', 'Exact title'),
    ])
  ).toBe('Exact title');
});

test.each(['bundled', 'app-platform', 'other-source', ''])(
  'does not borrow titles across unrelated source %s',
  (source) => {
    expect(guideTitle(source, 'same-slug', [completion('interactive-tutorials')])).toBe('same-slug');
    expect(guideTitle('online-cdn', 'same-slug', [completion(source)])).toBe('same-slug');
  }
);

test('does not borrow a title from another guide or use guide evidence as a path title', () => {
  expect(guideTitle('online-cdn', 'different-slug', [completion('interactive-tutorials')])).toBe('different-slug');
  expect(
    assignmentTitle({ ...assignment, targetType: 'path', targetSource: 'online-cdn', targetId: 'same-slug' }, [
      completion('interactive-tutorials'),
    ])
  ).toBe('same-slug');
});
