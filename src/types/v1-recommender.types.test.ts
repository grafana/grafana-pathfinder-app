/**
 * V1 Recommender Types Tests
 *
 * Verifies the isPackageRecommendation type guard discriminates correctly.
 */

import { isPackageRecommendation, V1Recommendation } from './v1-recommender.types';

describe('isPackageRecommendation', () => {
  it('returns true for a package-backed recommendation with manifest', () => {
    const rec: V1Recommendation = {
      type: 'package',
      title: 'Alerting 101',
      contentUrl: 'https://cdn.example.com/alerting-101/content.json',
      manifestUrl: 'https://cdn.example.com/alerting-101/manifest.json',
      repository: 'interactive-tutorials',
      manifest: { id: 'alerting-101', type: 'guide' },
    };
    expect(isPackageRecommendation(rec)).toBe(true);
  });

  it('returns false for a URL-backed recommendation', () => {
    const rec: V1Recommendation = {
      type: 'docs-page',
      title: 'Grafana Alerting docs',
      url: 'https://grafana.com/docs/grafana/latest/alerting/',
    };
    expect(isPackageRecommendation(rec)).toBe(false);
  });

  it('returns false for type "package" but missing manifest', () => {
    const rec: V1Recommendation = {
      type: 'package',
      title: 'Orphaned package rec',
      contentUrl: '',
      manifestUrl: '',
    };
    expect(isPackageRecommendation(rec)).toBe(false);
  });

  it('returns false for type "learning-journey"', () => {
    const rec: V1Recommendation = {
      type: 'learning-journey',
      title: 'Explore learning journeys',
      url: 'https://grafana.com/docs/learning-journeys/',
    };
    expect(isPackageRecommendation(rec)).toBe(false);
  });

  it('returns true when manifest has all optional fields populated', () => {
    const rec: V1Recommendation = {
      type: 'package',
      title: 'Full package',
      contentUrl: 'https://cdn.example.com/full/content.json',
      manifestUrl: 'https://cdn.example.com/full/manifest.json',
      repository: 'test-repo',
      manifest: {
        id: 'full-guide',
        type: 'guide',
        description: 'Full guide description',
        category: 'general',
        author: { name: 'Test Author', team: 'test-team' },
        startingLocation: '/alerting',
        milestones: ['step-1', 'step-2'],
        depends: ['prereq-1'],
        recommends: ['next-1'],
        suggests: ['related-1'],
        provides: ['alerting-basics'],
        conflicts: [],
        replaces: ['old-alerting-guide'],
      },
    };
    expect(isPackageRecommendation(rec)).toBe(true);
  });
});
