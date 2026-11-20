import { BADGES } from './badges';
import { getCourseCompletionBadges } from './course-badges';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { settings: { cloudMigrationIsTarget: true } } } }));

it('finds the real completion badge for a documentation course without package metadata', () => {
  expect(
    getCourseCompletionBadges({ baseUrl: 'https://grafana.com/docs/learning-paths/drilldown-metrics/' }).map(
      (badge) => badge.id
    )
  ).toEqual(['metric-miner']);
});

it('returns every course-completion reward and excludes general achievements', () => {
  const originalLength = BADGES.length;
  BADGES.push({
    id: 'second-metric-reward',
    title: 'Second reward',
    description: '',
    icon: 'star',
    trigger: { type: 'path-completed', pathId: 'drilldown-metrics' },
  });
  try {
    expect(getCourseCompletionBadges({ pathId: 'drilldown-metrics', baseUrl: '' }).map((badge) => badge.id)).toEqual([
      'metric-miner',
      'second-metric-reward',
    ]);
  } finally {
    BADGES.splice(originalLength);
  }
});

it('does not promise public badges for an organization course with the same ID', () => {
  expect(
    getCourseCompletionBadges({
      pathId: 'drilldown-metrics',
      baseUrl: 'backend-guide:drilldown-metrics',
      organization: true,
    })
  ).toEqual([]);
  expect(
    getCourseCompletionBadges({ pathId: 'grafana-foundations-lp', baseUrl: 'backend-guide:grafana-foundations-lp' })
  ).toEqual([]);
});

it('keeps an explicit package identity instead of stripping its suffix or substituting a curated URL identity', () => {
  expect(
    getCourseCompletionBadges({
      pathId: 'drilldown-metrics-lj',
      baseUrl: 'https://grafana.com/docs/learning-paths/drilldown-metrics/',
    })
  ).toEqual([]);
});
