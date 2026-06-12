/**
 * Guide chain planner tests.
 *
 * Covers ID mapping, dependency ordering, recursive auto-inclusion of missing
 * prerequisites, virtual-capability resolution, cycle detection, OR-group
 * handling, and deterministic chain ordering.
 */

import type { RepositoryJson } from '../../types/package.types';
import type { LoadedGuide } from './file-loader';
import { deriveGuideId, planGuideExecution, type GuideChain } from './guide-chains';

function guide(id: string): LoadedGuide {
  return { path: `${id}/content.json`, content: JSON.stringify({ id, title: id, blocks: [] }) };
}

function loaderFrom(available: Record<string, LoadedGuide>) {
  return (id: string): LoadedGuide | null => available[id] ?? null;
}

function chainIds(chain: GuideChain): string[] {
  return chain.map((p) => p.id);
}

describe('deriveGuideId', () => {
  it('prefers the content.json id field', () => {
    expect(deriveGuideId({ path: 'some-dir/content.json', content: JSON.stringify({ id: 'real-id' }) })).toBe(
      'real-id'
    );
  });

  it('falls back to the package directory name when content is not parseable', () => {
    expect(deriveGuideId({ path: 'welcome-to-grafana/content.json', content: 'not json' })).toBe('welcome-to-grafana');
  });

  it('falls back to a flat file name without extension', () => {
    expect(deriveGuideId({ path: 'guides/legacy.json', content: 'not json' })).toBe('legacy');
  });
});

describe('planGuideExecution', () => {
  it('orders a prerequisite before its dependent regardless of selection order', () => {
    const repository: RepositoryJson = {
      'prometheus-grafana-101': { path: 'prometheus-grafana-101/', type: 'guide', provides: ['prometheus-configured'] },
      'loki-grafana-101': { path: 'loki-grafana-101/', type: 'guide', depends: ['prometheus-grafana-101'] },
    };

    // Deliberately reversed selection order.
    const plan = planGuideExecution({
      guides: [guide('loki-grafana-101'), guide('prometheus-grafana-101')],
      repository,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.chains).toHaveLength(1);
    expect(chainIds(plan.chains[0]!)).toEqual(['prometheus-grafana-101', 'loki-grafana-101']);
    expect(plan.autoIncludedIds).toEqual([]);
    // The dependent records its concrete prerequisite.
    expect(plan.chains[0]![1]!.dependencies).toEqual(['prometheus-grafana-101']);
  });

  it('auto-includes a missing prerequisite and runs it first', () => {
    const repository: RepositoryJson = {
      'prometheus-grafana-101': { path: 'prometheus-grafana-101/', type: 'guide' },
      'loki-grafana-101': { path: 'loki-grafana-101/', type: 'guide', depends: ['prometheus-grafana-101'] },
    };

    const plan = planGuideExecution({
      guides: [guide('loki-grafana-101')],
      repository,
      loadGuideById: loaderFrom({ 'prometheus-grafana-101': guide('prometheus-grafana-101') }),
    });

    expect(plan.errors).toEqual([]);
    expect(plan.autoIncludedIds).toEqual(['prometheus-grafana-101']);
    expect(plan.chains).toHaveLength(1);
    expect(chainIds(plan.chains[0]!)).toEqual(['prometheus-grafana-101', 'loki-grafana-101']);
    const prometheus = plan.chains[0]![0]!;
    expect(prometheus.autoIncluded).toBe(true);
  });

  it('recursively auto-includes transitive prerequisites in dependency order', () => {
    const repository: RepositoryJson = {
      a: { path: 'a/', type: 'guide', depends: ['b'] },
      b: { path: 'b/', type: 'guide', depends: ['c'] },
      c: { path: 'c/', type: 'guide' },
    };

    const plan = planGuideExecution({
      guides: [guide('a')],
      repository,
      loadGuideById: loaderFrom({ b: guide('b'), c: guide('c') }),
    });

    expect(plan.errors).toEqual([]);
    expect(plan.chains).toHaveLength(1);
    expect(chainIds(plan.chains[0]!)).toEqual(['c', 'b', 'a']);
    expect(plan.autoIncludedIds).toEqual(['b', 'c']);
  });

  it('resolves a virtual capability target through provides', () => {
    const repository: RepositoryJson = {
      'prometheus-grafana-101': { path: 'prometheus-grafana-101/', type: 'guide', provides: ['prometheus-configured'] },
      'loki-grafana-101': { path: 'loki-grafana-101/', type: 'guide', depends: ['prometheus-configured'] },
    };

    const plan = planGuideExecution({
      guides: [guide('loki-grafana-101')],
      repository,
      loadGuideById: loaderFrom({ 'prometheus-grafana-101': guide('prometheus-grafana-101') }),
    });

    expect(plan.errors).toEqual([]);
    expect(chainIds(plan.chains[0]!)).toEqual(['prometheus-grafana-101', 'loki-grafana-101']);
    expect(plan.autoIncludedIds).toEqual(['prometheus-grafana-101']);
  });

  it('groups unrelated guides into separate singleton chains, ordered deterministically', () => {
    const repository: RepositoryJson = {
      zebra: { path: 'zebra/', type: 'guide' },
      apple: { path: 'apple/', type: 'guide' },
    };

    const plan = planGuideExecution({
      guides: [guide('zebra'), guide('apple')],
      repository,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.chains).toHaveLength(2);
    expect(plan.chains.map((c) => chainIds(c))).toEqual([['apple'], ['zebra']]);
  });

  it('orders multiple chains deterministically by their first guide', () => {
    const repository: RepositoryJson = {
      'm-base': { path: 'm-base/', type: 'guide' },
      'm-dep': { path: 'm-dep/', type: 'guide', depends: ['m-base'] },
      'a-standalone': { path: 'a-standalone/', type: 'guide' },
    };

    const plan = planGuideExecution({
      guides: [guide('m-dep'), guide('m-base'), guide('a-standalone')],
      repository,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.chains.map((c) => chainIds(c))).toEqual([['a-standalone'], ['m-base', 'm-dep']]);
  });

  it('detects depends cycles and fails the plan', () => {
    const repository: RepositoryJson = {
      a: { path: 'a/', type: 'guide', depends: ['b'] },
      b: { path: 'b/', type: 'guide', depends: ['a'] },
    };

    const plan = planGuideExecution({
      guides: [guide('a'), guide('b')],
      repository,
    });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((e) => e.includes('Cycle in depends chain'))).toBe(true);
  });

  describe('OR-group dependencies', () => {
    const repository: RepositoryJson = {
      dependent: { path: 'dependent/', type: 'guide', depends: [['alt-a', 'alt-b']] },
      'alt-a': { path: 'alt-a/', type: 'guide' },
      'alt-b': { path: 'alt-b/', type: 'guide' },
    };

    it('uses an already-selected alternative without auto-including', () => {
      const plan = planGuideExecution({
        guides: [guide('dependent'), guide('alt-b')],
        repository,
        loadGuideById: loaderFrom({ 'alt-a': guide('alt-a'), 'alt-b': guide('alt-b') }),
      });

      expect(plan.errors).toEqual([]);
      expect(plan.autoIncludedIds).toEqual([]);
      expect(chainIds(plan.chains[0]!)).toEqual(['alt-b', 'dependent']);
    });

    it('auto-includes the first resolvable alternative when none are selected', () => {
      const plan = planGuideExecution({
        guides: [guide('dependent')],
        repository,
        loadGuideById: loaderFrom({ 'alt-a': guide('alt-a'), 'alt-b': guide('alt-b') }),
      });

      expect(plan.errors).toEqual([]);
      expect(plan.autoIncludedIds).toEqual(['alt-a']);
      expect(chainIds(plan.chains[0]!)).toEqual(['alt-a', 'dependent']);
    });
  });

  it('treats guides without a repository entry as dependency-free singletons', () => {
    const plan = planGuideExecution({
      guides: [guide('unmanaged-1'), guide('unmanaged-2')],
      repository: {},
    });

    expect(plan.errors).toEqual([]);
    expect(plan.chains).toHaveLength(2);
    expect(plan.chains.every((c) => c.length === 1)).toBe(true);
  });

  it('errors when a prerequisite cannot be loaded for auto-inclusion', () => {
    const repository: RepositoryJson = {
      'loki-grafana-101': { path: 'loki-grafana-101/', type: 'guide', depends: ['prometheus-grafana-101'] },
      'prometheus-grafana-101': { path: 'prometheus-grafana-101/', type: 'guide' },
    };

    const plan = planGuideExecution({
      guides: [guide('loki-grafana-101')],
      repository,
      loadGuideById: () => null,
    });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((e) => e.includes('could not load auto-included prerequisite'))).toBe(true);
  });

  it('fails the plan when a depends target resolves to nothing (hard gate)', () => {
    const repository: RepositoryJson = {
      orphan: { path: 'orphan/', type: 'guide', depends: ['does-not-exist'] },
    };

    const plan = planGuideExecution({
      guides: [guide('orphan')],
      repository,
    });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((e) => e.includes('does-not-exist'))).toBe(true);
  });

  it('resolves OR-groups as a pure function of the selection set', () => {
    const repository: RepositoryJson = {
      x: { path: 'x/', type: 'guide', depends: [['alt-a', 'alt-b']] },
      y: { path: 'y/', type: 'guide', depends: ['alt-b'] },
      'alt-a': { path: 'alt-a/', type: 'guide' },
      'alt-b': { path: 'alt-b/', type: 'guide' },
    };
    const loadGuideById = loaderFrom({ 'alt-a': guide('alt-a'), 'alt-b': guide('alt-b') });

    const forward = planGuideExecution({ guides: [guide('x'), guide('y')], repository, loadGuideById });
    const reverse = planGuideExecution({ guides: [guide('y'), guide('x')], repository, loadGuideById });

    const shape = (plan: ReturnType<typeof planGuideExecution>) => plan.chains.map((c) => chainIds(c));
    expect(shape(forward)).toEqual(shape(reverse));

    // y's forced alt-b is resolved first, so x's OR-group reuses it: one chain.
    expect(forward.errors).toEqual([]);
    expect(forward.autoIncludedIds).toEqual(['alt-b']);
    expect(forward.chains).toHaveLength(1);
    expect(chainIds(forward.chains[0]!)).toEqual(['alt-b', 'x', 'y']);
  });

  it('fails the plan when two selected files derive the same id from different paths', () => {
    const a: LoadedGuide = {
      path: 'dir-a/content.json',
      content: JSON.stringify({ id: 'dup', title: 'dup', blocks: [] }),
    };
    const b: LoadedGuide = {
      path: 'dir-b/content.json',
      content: JSON.stringify({ id: 'dup', title: 'dup', blocks: [] }),
    };

    const plan = planGuideExecution({ guides: [a, b], repository: {} });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((e) => e.includes('duplicate guide id'))).toBe(true);
  });
});
