/**
 * Guide chain planner tests.
 *
 * Covers ID mapping, dependency ordering, recursive auto-inclusion of missing
 * prerequisites, virtual-capability resolution, cycle detection, OR-group
 * handling, and deterministic chain ordering.
 */

import type { RepositoryJson } from '../../types/package.types';
import type { LoadedGuide } from '../utils/file-loader';
import { deriveGuideId, planGuideExecution, planPackageExecution, type GuideChain } from './guide-chains';

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

describe('planPackageExecution', () => {
  it('expands path milestones in declared order without making order a hard dependency', () => {
    const repository: RepositoryJson = {
      path: { path: 'path/', type: 'path', milestones: ['first', 'second', 'third'] },
      first: { path: 'path/first/', type: 'guide' },
      second: { path: 'path/second/', type: 'guide' },
      third: { path: 'path/third/', type: 'guide', depends: ['first'] },
    };

    const plan = planPackageExecution({ rootIds: ['path'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.chains.map((chain) => chain.map((guide) => guide.id))).toEqual([['first', 'second', 'third']]);
    expect(plan.chains[0]![0]!.dependencies).toEqual([]);
    expect(plan.chains[0]![1]!.dependencies).toEqual([]);
    expect(plan.chains[0]![2]!.dependencies).toEqual(['first']);
    expect(plan.chains[0]!.every((guide) => !guide.autoIncluded)).toBe(true);
  });

  it('recursively expands journey and path milestones', () => {
    const repository: RepositoryJson = {
      journey: { path: 'journey/', type: 'journey', milestones: ['path-a', 'standalone', 'path-b'] },
      'path-a': { path: 'path-a/', type: 'path', milestones: ['a-1', 'a-2'] },
      'path-b': { path: 'path-b/', type: 'path', milestones: ['b-1'] },
      'a-1': { path: 'path-a/a-1/', type: 'guide' },
      'a-2': { path: 'path-a/a-2/', type: 'guide' },
      standalone: { path: 'standalone/', type: 'guide' },
      'b-1': { path: 'path-b/b-1/', type: 'guide' },
    };

    const plan = planPackageExecution({ rootIds: ['journey'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.chains[0]!.map((guide) => guide.id)).toEqual(['a-1', 'a-2', 'standalone', 'b-1']);
  });

  it('expands a path-level dependency on another path and gates every dependent milestone', () => {
    const repository: RepositoryJson = {
      prerequisite: { path: 'prerequisite/', type: 'path', milestones: ['setup-a', 'setup-b'] },
      target: { path: 'target/', type: 'path', milestones: ['target-a', 'target-b'], depends: ['prerequisite'] },
      'setup-a': { path: 'prerequisite/setup-a/', type: 'guide' },
      'setup-b': { path: 'prerequisite/setup-b/', type: 'guide' },
      'target-a': { path: 'target/target-a/', type: 'guide' },
      'target-b': { path: 'target/target-b/', type: 'guide' },
    };

    const plan = planPackageExecution({ rootIds: ['target'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.chains[0]!.map((guide) => guide.id)).toEqual(['setup-a', 'setup-b', 'target-a', 'target-b']);
    expect(plan.autoIncludedIds).toEqual(['setup-a', 'setup-b']);
    expect(plan.chains[0]![2]!.dependencies).toEqual(['setup-a', 'setup-b']);
    expect(plan.chains[0]![3]!.dependencies).toEqual(['setup-a', 'setup-b']);
  });

  it('can satisfy a dependency capability with a metapackage provider', () => {
    const repository: RepositoryJson = {
      target: { path: 'target/', type: 'path', milestones: ['target-step'], depends: ['environment-ready'] },
      provider: {
        path: 'provider/',
        type: 'path',
        milestones: ['provider-a', 'provider-b'],
        provides: ['environment-ready'],
      },
      'target-step': { path: 'target/target-step/', type: 'guide' },
      'provider-a': { path: 'provider/provider-a/', type: 'guide' },
      'provider-b': { path: 'provider/provider-b/', type: 'guide' },
    };

    const plan = planPackageExecution({ rootIds: ['target'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.chains[0]!.map((guide) => guide.id)).toEqual(['provider-a', 'provider-b', 'target-step']);
    expect(plan.chains[0]![2]!.dependencies).toEqual(['provider-a', 'provider-b']);
  });

  it('reuses a forced provider across milestones within the same root', () => {
    const repository: RepositoryJson = {
      path: { path: 'path/', type: 'path', milestones: ['x', 'y'] },
      x: { path: 'path/x/', type: 'guide', depends: [['alt-a', 'alt-b']] },
      y: { path: 'path/y/', type: 'guide', depends: ['alt-b'] },
      'alt-a': { path: 'alt-a/', type: 'guide' },
      'alt-b': { path: 'alt-b/', type: 'guide' },
    };

    const plan = planPackageExecution({ rootIds: ['path'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.autoIncludedIds).toEqual(['alt-b']);
    expect(plan.chains[0]!.map((guide) => guide.id)).toEqual(['alt-b', 'x', 'y']);
    expect(plan.chains[0]!.find((guide) => guide.id === 'x')?.dependencies).toEqual(['alt-b']);
  });

  it('executes a shared leaf once when composition reaches it through multiple milestones', () => {
    const repository: RepositoryJson = {
      root: { path: 'root/', type: 'journey', milestones: ['nested', 'shared'] },
      nested: { path: 'nested/', type: 'path', milestones: ['shared', 'nested-only'] },
      shared: { path: 'shared/', type: 'guide' },
      'nested-only': { path: 'nested/nested-only/', type: 'guide' },
    };

    const plan = planPackageExecution({ rootIds: ['root'], repository });

    expect(plan.errors).toEqual([]);
    expect(plan.chains[0]!.map((guide) => guide.id)).toEqual(['shared', 'nested-only']);
  });

  it('fails when a milestone is missing from the repository index', () => {
    const repository: RepositoryJson = {
      path: { path: 'path/', type: 'path', milestones: ['missing'] },
    };

    const plan = planPackageExecution({ rootIds: ['path'], repository });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((error) => error.includes('missing from the repository index'))).toBe(true);
  });

  it('detects a cycle that crosses milestone and depends relationships', () => {
    const repository: RepositoryJson = {
      path: { path: 'path/', type: 'path', milestones: ['step'] },
      step: { path: 'path/step/', type: 'guide', depends: ['path'] },
    };

    const plan = planPackageExecution({ rootIds: ['path'], repository });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((error) => error.includes('Cycle across depends and milestones'))).toBe(true);
  });

  it('fails when a path has an empty milestones array', () => {
    const plan = planPackageExecution({
      rootIds: ['empty-path'],
      repository: { 'empty-path': { path: 'empty-path/', type: 'path', milestones: [] } },
    });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((error) => error.includes('has no milestones'))).toBe(true);
  });

  it('detects a pure milestone-only cycle without any depends edges', () => {
    const repository: RepositoryJson = {
      'path-a': { path: 'path-a/', type: 'path', milestones: ['path-b'] },
      'path-b': { path: 'path-b/', type: 'path', milestones: ['path-a'] },
    };

    const plan = planPackageExecution({ rootIds: ['path-a'], repository });

    expect(plan.chains).toEqual([]);
    expect(plan.errors.some((error) => error.includes('Cycle in milestones'))).toBe(true);
  });

  it('keeps OR-provider choices invariant when independently valid roots are batched', () => {
    const repository: RepositoryJson = {
      pkgx: { path: 'pkgx/', type: 'guide', depends: [['pkgp', 'pkgq']] },
      pkgp: { path: 'pkgp/', type: 'guide' },
      pkgq: { path: 'pkgq/', type: 'guide', depends: [['pkgz', 'pkgx']] },
      pkgz: { path: 'pkgz/', type: 'guide' },
      pkgy2: { path: 'pkgy2/', type: 'guide', depends: ['pkgq'] },
    };

    const xPlan = planPackageExecution({ rootIds: ['pkgx'], repository });
    const yPlan = planPackageExecution({ rootIds: ['pkgy2'], repository });
    const unionPlan = planPackageExecution({ rootIds: ['pkgx', 'pkgy2'], repository });

    expect(xPlan.errors).toEqual([]);
    expect(yPlan.errors).toEqual([]);
    expect(unionPlan.errors).toEqual([]);
    expect(unionPlan.chains.flat().map((guide) => guide.id)).toEqual(['pkgp', 'pkgx', 'pkgz', 'pkgq', 'pkgy2']);
    expect(unionPlan.chains.flat().find((guide) => guide.id === 'pkgx')?.dependencies).toEqual(['pkgp']);
    expect(unionPlan.chains.flat().find((guide) => guide.id === 'pkgq')?.dependencies).toEqual(['pkgz']);
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

    it('does not let a sibling root change the selected alternative', () => {
      const plan = planGuideExecution({
        guides: [guide('dependent'), guide('alt-b')],
        repository,
        loadGuideById: loaderFrom({ 'alt-a': guide('alt-a'), 'alt-b': guide('alt-b') }),
      });

      expect(plan.errors).toEqual([]);
      expect(plan.autoIncludedIds).toEqual(['alt-a']);
      expect(plan.chains.map((chain) => chainIds(chain))).toEqual([['alt-a', 'dependent'], ['alt-b']]);
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

  it('resolves OR-groups independently of sibling roots and selection order', () => {
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

    expect(forward.errors).toEqual([]);
    expect(forward.autoIncludedIds).toEqual(['alt-a', 'alt-b']);
    expect(forward.chains.map((chain) => chainIds(chain))).toEqual([
      ['alt-a', 'x'],
      ['alt-b', 'y'],
    ]);
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
