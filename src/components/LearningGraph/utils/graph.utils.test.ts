import type { DependencyGraph, GraphNode, GraphEdge } from '../../../types/package.types';
import {
  collapseMilestones,
  applyFilters,
  getEligibleNextGuides,
  resolveContentUrl,
  extractCategories,
} from './graph.utils';
import { DEFAULT_FILTER_STATE } from '../types';

// ============ FIXTURES ============

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return { id, type: 'guide', repository: 'test-repo', ...overrides };
}

function makeEdge(source: string, target: string, type: GraphEdge['type']): GraphEdge {
  return { source, target, type };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): DependencyGraph {
  return {
    nodes,
    edges,
    metadata: {
      generatedAt: '2026-01-01T00:00:00Z',
      repositories: ['test-repo'],
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };
}

// ============ resolveContentUrl ============

describe('resolveContentUrl', () => {
  it('builds a content.json URL from the node id', () => {
    const node = makeNode('alerting-101');
    expect(resolveContentUrl(node)).toBe('https://interactive-learning.grafana.net/packages/alerting-101/content.json');
  });

  it('handles ids with hyphens and numbers', () => {
    const node = makeNode('prometheus-grafana-101');
    expect(resolveContentUrl(node)).toContain('prometheus-grafana-101/content.json');
  });
});

// ============ collapseMilestones ============

describe('collapseMilestones', () => {
  it('removes milestone children from top-level nodes', () => {
    const path = makeNode('intro-path', { type: 'path', milestones: ['guide-a', 'guide-b'] });
    const guideA = makeNode('guide-a');
    const guideB = makeNode('guide-b');
    const standalone = makeNode('standalone');

    const graph = makeGraph(
      [path, guideA, guideB, standalone],
      [makeEdge('intro-path', 'guide-a', 'milestones'), makeEdge('intro-path', 'guide-b', 'milestones')]
    );

    const result = collapseMilestones(graph);

    expect(result.nodes.map((n) => n.id)).toEqual(['intro-path', 'standalone']);
    expect(result.edges).toHaveLength(0);
  });

  it('rewires edges targeting a milestone child to the parent path', () => {
    const path = makeNode('my-path', { type: 'path' });
    const child = makeNode('child-guide');
    const downstream = makeNode('downstream');

    const graph = makeGraph(
      [path, child, downstream],
      [makeEdge('my-path', 'child-guide', 'milestones'), makeEdge('child-guide', 'downstream', 'recommends')]
    );

    const result = collapseMilestones(graph);

    expect(result.nodes.map((n) => n.id)).toEqual(['my-path', 'downstream']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: 'my-path', target: 'downstream', type: 'recommends' });
  });

  it('deduplicates rewired edges', () => {
    const path = makeNode('path-a', { type: 'path' });
    const childA = makeNode('child-a');
    const childB = makeNode('child-b');
    const downstream = makeNode('ds');

    const graph = makeGraph(
      [path, childA, childB, downstream],
      [
        makeEdge('path-a', 'child-a', 'milestones'),
        makeEdge('path-a', 'child-b', 'milestones'),
        makeEdge('child-a', 'ds', 'recommends'),
        makeEdge('child-b', 'ds', 'recommends'),
      ]
    );

    const result = collapseMilestones(graph);
    const recommends = result.edges.filter((e) => e.type === 'recommends');
    expect(recommends).toHaveLength(1);
  });

  it('leaves graphs without paths unchanged (no milestone edges)', () => {
    const g1 = makeNode('g1');
    const g2 = makeNode('g2');
    const graph = makeGraph([g1, g2], [makeEdge('g1', 'g2', 'recommends')]);

    const result = collapseMilestones(graph);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('leaves milestone children visible when their path is in expandedPaths', () => {
    const path = makeNode('exp-path', { type: 'path' });
    const childA = makeNode('child-a');
    const childB = makeNode('child-b');

    const graph = makeGraph(
      [path, childA, childB],
      [makeEdge('exp-path', 'child-a', 'milestones'), makeEdge('exp-path', 'child-b', 'milestones')]
    );

    const result = collapseMilestones(graph, new Set(['exp-path']));

    expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['exp-path', 'child-a', 'child-b']));
    expect(result.edges.filter((e) => e.type === 'milestones')).toHaveLength(2);
  });

  it('collapses other paths while leaving expanded ones intact', () => {
    const pathA = makeNode('path-a', { type: 'path' });
    const pathB = makeNode('path-b', { type: 'path' });
    const childA = makeNode('child-of-a');
    const childB = makeNode('child-of-b');

    const graph = makeGraph(
      [pathA, pathB, childA, childB],
      [makeEdge('path-a', 'child-of-a', 'milestones'), makeEdge('path-b', 'child-of-b', 'milestones')]
    );

    // Only expand path-b
    const result = collapseMilestones(graph, new Set(['path-b']));

    // path-a's child should be collapsed (swallowed)
    expect(result.nodes.map((n) => n.id)).not.toContain('child-of-a');
    // path-b's child should remain visible
    expect(result.nodes.map((n) => n.id)).toContain('child-of-b');
  });

  it('does not re-wire external edges that target children of an expanded path', () => {
    const path = makeNode('exp-path', { type: 'path' });
    const child = makeNode('child-guide');
    const downstream = makeNode('downstream');

    const graph = makeGraph(
      [path, child, downstream],
      [makeEdge('exp-path', 'child-guide', 'milestones'), makeEdge('child-guide', 'downstream', 'recommends')]
    );

    const result = collapseMilestones(graph, new Set(['exp-path']));

    // The recommends edge should still point at child-guide, not re-wired to exp-path
    const recommends = result.edges.find((e) => e.type === 'recommends');
    expect(recommends).toMatchObject({ source: 'child-guide', target: 'downstream' });
  });
});

// ============ applyFilters ============

describe('applyFilters', () => {
  const guide1 = makeNode('g1', { category: 'alerting' });
  const guide2 = makeNode('g2', { category: 'dashboards' });
  const path1 = makeNode('p1', { type: 'path', category: 'alerting' });
  const baseGraph = makeGraph(
    [guide1, guide2, path1],
    [makeEdge('g1', 'g2', 'recommends'), makeEdge('p1', 'g2', 'depends')]
  );

  it('returns all nodes with default filters', () => {
    const result = applyFilters(
      baseGraph,
      { ...DEFAULT_FILTER_STATE, edgeTypes: new Set(['recommends', 'depends']) },
      []
    );
    expect(result.nodes).toHaveLength(3);
  });

  it('filters by type — paths only (no milestone edges → no milestone guides added)', () => {
    const result = applyFilters(baseGraph, { ...DEFAULT_FILTER_STATE, typeFilter: 'paths', edgeTypes: new Set() }, []);
    expect(result.nodes.map((n) => n.id)).toEqual(['p1']);
  });

  it('filters by type — paths: includes milestone guides of surviving path nodes', () => {
    const path = makeNode('p-with-milestones', { type: 'path' });
    const milestoneGuide = makeNode('milestone-g', { type: 'guide' });
    const standaloneGuide = makeNode('standalone-g', { type: 'guide' });
    const graph = makeGraph(
      [path, milestoneGuide, standaloneGuide],
      [makeEdge('p-with-milestones', 'milestone-g', 'milestones')]
    );

    const result = applyFilters(graph, { ...DEFAULT_FILTER_STATE, typeFilter: 'paths', edgeTypes: new Set() }, []);

    expect(result.nodes.map((n) => n.id)).toContain('p-with-milestones');
    expect(result.nodes.map((n) => n.id)).toContain('milestone-g');
    // Standalone guides not attached as milestones are excluded
    expect(result.nodes.map((n) => n.id)).not.toContain('standalone-g');
  });

  it('filters by type — paths: milestone guide milestone edges are kept', () => {
    const path = makeNode('p1-ms', { type: 'path' });
    const guide = makeNode('g-ms', { type: 'guide' });
    const graph = makeGraph([path, guide], [makeEdge('p1-ms', 'g-ms', 'milestones')]);

    const result = applyFilters(graph, { ...DEFAULT_FILTER_STATE, typeFilter: 'paths', edgeTypes: new Set() }, []);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ source: 'p1-ms', target: 'g-ms', type: 'milestones' });
  });

  it('filters by type — paths: milestone guide respects completion filter', () => {
    const path = makeNode('p-compl', { type: 'path' });
    const completedGuide = makeNode('guide-done', { type: 'guide' });
    const incompleteGuide = makeNode('guide-todo', { type: 'guide' });
    const graph = makeGraph(
      [path, completedGuide, incompleteGuide],
      [makeEdge('p-compl', 'guide-done', 'milestones'), makeEdge('p-compl', 'guide-todo', 'milestones')]
    );

    const result = applyFilters(
      graph,
      { ...DEFAULT_FILTER_STATE, typeFilter: 'paths', completionFilter: 'not-started', edgeTypes: new Set() },
      ['guide-done']
    );

    expect(result.nodes.map((n) => n.id)).toContain('guide-todo');
    expect(result.nodes.map((n) => n.id)).not.toContain('guide-done');
  });

  it('filters by type — journeys: includes milestone guides of surviving journey nodes', () => {
    const journey = makeNode('j1', { type: 'journey' });
    const milestoneGuide = makeNode('j-guide', { type: 'guide' });
    const standaloneGuide = makeNode('solo-g', { type: 'guide' });
    const graph = makeGraph([journey, milestoneGuide, standaloneGuide], [makeEdge('j1', 'j-guide', 'milestones')]);

    const result = applyFilters(graph, { ...DEFAULT_FILTER_STATE, typeFilter: 'journeys', edgeTypes: new Set() }, []);

    expect(result.nodes.map((n) => n.id)).toContain('j1');
    expect(result.nodes.map((n) => n.id)).toContain('j-guide');
    expect(result.nodes.map((n) => n.id)).not.toContain('solo-g');
  });

  it('filters by category', () => {
    const result = applyFilters(
      baseGraph,
      { ...DEFAULT_FILTER_STATE, categories: new Set(['alerting']), edgeTypes: new Set() },
      []
    );
    expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['g1', 'p1']));
    expect(result.nodes.map((n) => n.id)).not.toContain('g2');
  });

  it('filters completed nodes', () => {
    const result = applyFilters(
      baseGraph,
      { ...DEFAULT_FILTER_STATE, completionFilter: 'completed', edgeTypes: new Set() },
      ['g1']
    );
    expect(result.nodes.map((n) => n.id)).toEqual(['g1']);
  });

  it('filters not-started nodes', () => {
    const result = applyFilters(
      baseGraph,
      { ...DEFAULT_FILTER_STATE, completionFilter: 'not-started', edgeTypes: new Set() },
      ['g1']
    );
    expect(result.nodes.map((n) => n.id)).not.toContain('g1');
    expect(result.nodes.map((n) => n.id)).toContain('g2');
  });

  it('removes edges whose type is not in the active set', () => {
    const result = applyFilters(baseGraph, { ...DEFAULT_FILTER_STATE, edgeTypes: new Set(['recommends']) }, []);
    expect(result.edges.every((e) => e.type === 'recommends')).toBe(true);
  });

  it('removes edges whose endpoints are filtered out', () => {
    const result = applyFilters(
      baseGraph,
      { ...DEFAULT_FILTER_STATE, typeFilter: 'guides', edgeTypes: new Set(['recommends', 'depends']) },
      []
    );
    // p1 is a path so it's excluded — the depends edge (p1→g2) should also be removed
    expect(result.edges.every((e) => e.source !== 'p1' && e.target !== 'p1')).toBe(true);
  });
});

// ============ getEligibleNextGuides ============

describe('getEligibleNextGuides', () => {
  it('returns nodes with no depends as eligible', () => {
    const node = makeNode('free');
    const graph = makeGraph([node], []);
    const eligible = getEligibleNextGuides(graph, []);
    expect(eligible.map((n) => n.id)).toContain('free');
  });

  it('excludes already-completed nodes', () => {
    const node = makeNode('done');
    const graph = makeGraph([node], []);
    const eligible = getEligibleNextGuides(graph, ['done']);
    expect(eligible).toHaveLength(0);
  });

  it('returns nodes whose single dependency is satisfied', () => {
    const prereq = makeNode('prereq');
    const next = makeNode('next', { depends: ['prereq'] });
    const graph = makeGraph([prereq, next], [makeEdge('prereq', 'next', 'depends')]);

    const eligible = getEligibleNextGuides(graph, ['prereq']);
    expect(eligible.map((n) => n.id)).toContain('next');
  });

  it('excludes nodes with unsatisfied dependency', () => {
    const next = makeNode('locked', { depends: ['missing'] });
    const graph = makeGraph([next], []);
    const eligible = getEligibleNextGuides(graph, []);
    expect(eligible).toHaveLength(0);
  });

  it('handles OR-group dependencies (DependencyList with string[])', () => {
    const node = makeNode('either', { depends: [['a', 'b']] });
    const graph = makeGraph([node], []);

    expect(getEligibleNextGuides(graph, ['a']).map((n) => n.id)).toContain('either');
    expect(getEligibleNextGuides(graph, ['b']).map((n) => n.id)).toContain('either');
    expect(getEligibleNextGuides(graph, [])).toHaveLength(0);
  });

  it('handles AND-style dependencies (all must be satisfied)', () => {
    const node = makeNode('both', { depends: ['req1', 'req2'] });
    const graph = makeGraph([node], []);

    expect(getEligibleNextGuides(graph, ['req1'])).toHaveLength(0);
    expect(getEligibleNextGuides(graph, ['req1', 'req2']).map((n) => n.id)).toContain('both');
  });
});

// ============ extractCategories ============

describe('extractCategories', () => {
  it('returns sorted unique categories', () => {
    const nodes = [
      makeNode('a', { category: 'dashboards' }),
      makeNode('b', { category: 'alerting' }),
      makeNode('c', { category: 'dashboards' }),
      makeNode('d'),
    ];
    const graph = makeGraph(nodes, []);
    expect(extractCategories(graph)).toEqual(['alerting', 'dashboards']);
  });

  it('returns empty array when no categories', () => {
    const graph = makeGraph([makeNode('x')], []);
    expect(extractCategories(graph)).toEqual([]);
  });
});
