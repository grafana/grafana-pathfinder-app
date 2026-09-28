/**
 * @jest-environment node
 *
 * Tests for the source-manifest → `spec.manifest` projection.
 *
 * The reference implementation is `build_manifest` in
 * `scripts/upsert-learning-path.sh:197-224`; these cases pin the behaviours
 * that differ from a straight copy, so the two writers cannot drift.
 */

import { projectManifestForCrd } from '../crd-manifest';

describe('projectManifestForCrd', () => {
  it('returns undefined when there is no manifest to project', () => {
    expect(projectManifestForCrd(undefined)).toBeUndefined();
    expect(projectManifestForCrd(null)).toBeUndefined();
    expect(projectManifestForCrd('not-an-object')).toBeUndefined();
    expect(projectManifestForCrd([])).toBeUndefined();
    expect(projectManifestForCrd({})).toBeUndefined();
  });

  it('drops id — the resource name carries it', () => {
    const projected = projectManifestForCrd({ id: 'alerting-path', type: 'guide' });

    expect(projected).not.toHaveProperty('id');
    expect(projected).toEqual({ type: 'guide' });
  });

  it('keeps the CRD-typed fields verbatim', () => {
    const projected = projectManifestForCrd({
      id: 'alerting-path',
      type: 'path',
      repository: 'interactive-tutorials',
      description: 'Alerting enablement',
      category: 'alerting',
      author: { name: 'Ada', team: 'Docs' },
      milestones: ['alerting-intro', 'alerting-rules'],
    });

    expect(projected).toEqual({
      type: 'path',
      repository: 'interactive-tutorials',
      description: 'Alerting enablement',
      category: 'alerting',
      author: { name: 'Ada', team: 'Docs' },
      milestones: ['alerting-intro', 'alerting-rules'],
    });
  });

  it('widens bare depends IDs to CNF singleton clauses and leaves OR-groups alone', () => {
    const projected = projectManifestForCrd({
      type: 'guide',
      depends: ['grafana-basics', ['loki-intro', 'elastic-intro']],
    });

    expect(projected?.depends).toEqual([['grafana-basics'], ['loki-intro', 'elastic-intro']]);
  });

  it('emits milestones only for meta types', () => {
    const asGuide = projectManifestForCrd({ type: 'guide', milestones: ['a', 'b'] });
    const asJourney = projectManifestForCrd({ type: 'journey', milestones: ['a', 'b'] });

    expect(asGuide).not.toHaveProperty('milestones');
    expect(asJourney?.milestones).toEqual(['a', 'b']);
  });

  it('sweeps untyped keys into additionalFields rather than dropping them', () => {
    const projected = projectManifestForCrd({
      id: 'alerting-path',
      type: 'path',
      milestones: ['a'],
      language: 'en',
      startingLocation: '/alerting',
      testEnvironment: { tier: 'cloud' },
    });

    expect(projected?.additionalFields).toEqual({
      language: 'en',
      startingLocation: '/alerting',
      testEnvironment: { tier: 'cloud' },
    });
  });

  it('sweeps author sub-keys the CRD #Author does not declare', () => {
    const projected = projectManifestForCrd({
      type: 'guide',
      author: { name: 'Ada', team: 'Docs', email: 'ada@example.com' },
    });

    expect(projected?.author).toEqual({ name: 'Ada', team: 'Docs' });
    expect(projected?.additionalFields).toEqual({ author: { email: 'ada@example.com' } });
  });

  it('omits absent, null and empty-valued fields instead of emitting them', () => {
    const projected = projectManifestForCrd({
      type: 'guide',
      repository: '',
      description: null,
      author: { name: null, team: null },
      depends: [],
    });

    expect(projected).toEqual({ type: 'guide' });
  });
});
