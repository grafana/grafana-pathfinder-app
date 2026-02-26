/**
 * Build Graph Tests (Layer 1)
 *
 * Tests dependency graph construction, virtual capability handling,
 * cycle detection, and lint checks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildGraph, type GraphLintMessage } from '../cli/commands/build-graph';
import type { RepositoryJson } from '../types/package.types';

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-graph-'));
}

function writeRepository(dir: string, filename: string, data: RepositoryJson): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

function lintMessages(messages: GraphLintMessage[], severity?: 'error' | 'warn'): GraphLintMessage[] {
  if (!severity) {
    return messages;
  }
  return messages.filter((m) => m.severity === severity);
}

describe('buildGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should build an empty graph from an empty repository', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {});
    const { graph, errors } = buildGraph([{ name: 'test', path: repoPath }]);

    expect(errors).toHaveLength(0);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.metadata.repositories).toEqual(['test']);
  });

  it('should create nodes from repository entries', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'welcome-to-grafana': {
        path: 'welcome-to-grafana/',
        title: 'Welcome to Grafana',
        type: 'guide',
      },
      'prometheus-101': {
        path: 'prometheus-101/',
        title: 'Prometheus 101',
        type: 'guide',
        description: 'Learn Prometheus',
        category: 'data-availability',
      },
    });

    const { graph, errors } = buildGraph([{ name: 'tutorials', path: repoPath }]);

    expect(errors).toHaveLength(0);
    expect(graph.nodes).toHaveLength(2);

    const welcome = graph.nodes.find((n) => n.id === 'welcome-to-grafana');
    expect(welcome).toBeDefined();
    expect(welcome!.repository).toBe('tutorials');
    expect(welcome!.title).toBe('Welcome to Grafana');
    expect(welcome!.type).toBe('guide');
  });

  it('should create dependency edges', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'guide-a': { path: 'a/', type: 'guide', depends: ['guide-b'] },
      'guide-b': { path: 'b/', type: 'guide', recommends: ['guide-c'] },
      'guide-c': { path: 'c/', type: 'guide', suggests: ['guide-a'] },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    expect(graph.edges.some((e) => e.source === 'guide-a' && e.target === 'guide-b' && e.type === 'depends')).toBe(
      true
    );
    expect(graph.edges.some((e) => e.source === 'guide-b' && e.target === 'guide-c' && e.type === 'recommends')).toBe(
      true
    );
    expect(graph.edges.some((e) => e.source === 'guide-c' && e.target === 'guide-a' && e.type === 'suggests')).toBe(
      true
    );
  });

  it('should flatten CNF dependency clauses into edges', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'guide-a': { path: 'a/', type: 'guide', depends: ['x', ['y', 'z']] },
      x: { path: 'x/', type: 'guide' },
      y: { path: 'y/', type: 'guide' },
      z: { path: 'z/', type: 'guide' },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    const dependsEdges = graph.edges.filter((e) => e.source === 'guide-a' && e.type === 'depends');
    const targets = dependsEdges.map((e) => e.target).sort();
    expect(targets).toEqual(['x', 'y', 'z']);
  });

  it('should create virtual capability nodes', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'prometheus-101': {
        path: 'prometheus/',
        type: 'guide',
        provides: ['datasource-configured'],
      },
      'loki-101': {
        path: 'loki/',
        type: 'guide',
        provides: ['datasource-configured'],
      },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    const virtualNode = graph.nodes.find((n) => n.id === 'datasource-configured');
    expect(virtualNode).toBeDefined();
    expect(virtualNode!.virtual).toBe(true);

    const providesEdges = graph.edges.filter((e) => e.type === 'provides' && e.target === 'datasource-configured');
    expect(providesEdges).toHaveLength(2);
  });

  it('should not create virtual node when provides matches a real package', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'real-pkg': { path: 'real/', type: 'guide', provides: ['real-pkg'] },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    const realNodes = graph.nodes.filter((n) => n.id === 'real-pkg');
    expect(realNodes).toHaveLength(1);
    expect(realNodes[0]!.virtual).toBeUndefined();
  });

  it('should create steps edges', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'my-path': { path: 'path/', type: 'path', steps: ['step-1', 'step-2'] },
      'step-1': { path: 'step-1/', type: 'guide' },
      'step-2': { path: 'step-2/', type: 'guide' },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    const stepsEdges = graph.edges.filter((e) => e.source === 'my-path' && e.type === 'steps');
    expect(stepsEdges).toHaveLength(2);
    expect(stepsEdges.map((e) => e.target)).toEqual(['step-1', 'step-2']);
  });

  it('should create conflicts and replaces edges', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'new-guide': { path: 'new/', type: 'guide', conflicts: ['old-guide'], replaces: ['legacy-guide'] },
      'old-guide': { path: 'old/', type: 'guide' },
      'legacy-guide': { path: 'legacy/', type: 'guide' },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    expect(
      graph.edges.some((e) => e.source === 'new-guide' && e.target === 'old-guide' && e.type === 'conflicts')
    ).toBe(true);
    expect(
      graph.edges.some((e) => e.source === 'new-guide' && e.target === 'legacy-guide' && e.type === 'replaces')
    ).toBe(true);
  });

  it('should merge multiple repositories', () => {
    const repo1 = writeRepository(tmpDir, 'repo1.json', {
      'guide-a': { path: 'a/', type: 'guide', depends: ['guide-b'] },
    });
    const repo2 = writeRepository(tmpDir, 'repo2.json', {
      'guide-b': { path: 'b/', type: 'guide' },
    });

    const { graph, errors } = buildGraph([
      { name: 'bundled', path: repo1 },
      { name: 'remote', path: repo2 },
    ]);

    expect(errors).toHaveLength(0);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.metadata.repositories).toEqual(['bundled', 'remote']);

    const nodeA = graph.nodes.find((n) => n.id === 'guide-a');
    expect(nodeA!.repository).toBe('bundled');

    const nodeB = graph.nodes.find((n) => n.id === 'guide-b');
    expect(nodeB!.repository).toBe('remote');
  });

  it('should handle missing repository files', () => {
    const { errors } = buildGraph([{ name: 'missing', path: '/nonexistent/repo.json' }]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('buildGraph lint checks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should warn on broken dependency references', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'guide-a': { path: 'a/', type: 'guide', depends: ['nonexistent'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    expect(msgs.some((m) => m.message.includes('nonexistent') && m.message.includes('does not exist'))).toBe(true);
  });

  it('should not warn when dependency target is a virtual capability', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'guide-a': { path: 'a/', type: 'guide', depends: ['ds-configured'] },
      'guide-b': { path: 'b/', type: 'guide', provides: ['ds-configured'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    expect(msgs.filter((m) => m.message.includes('does not exist'))).toHaveLength(0);
  });

  it('should warn on broken step references', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'my-path': { path: 'path/', type: 'path', steps: ['missing-step'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    expect(msgs.some((m) => m.message.includes('missing-step') && m.message.includes('steps'))).toBe(true);
  });

  it('should detect cycles in depends chains', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      a: { path: 'a/', type: 'guide', depends: ['b'] },
      b: { path: 'b/', type: 'guide', depends: ['c'] },
      c: { path: 'c/', type: 'guide', depends: ['a'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    const cycleMsgs = lintMessages(msgs, 'error').filter((m) => m.message.includes('Cycle in depends'));
    expect(cycleMsgs.length).toBeGreaterThan(0);
  });

  it('should detect cycles in steps chains', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'path-a': { path: 'a/', type: 'path', steps: ['path-b'] },
      'path-b': { path: 'b/', type: 'path', steps: ['path-a'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    const cycleMsgs = lintMessages(msgs, 'error').filter((m) => m.message.includes('Cycle in steps'));
    expect(cycleMsgs.length).toBeGreaterThan(0);
  });

  it('should warn on cycles in recommends chains', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      a: { path: 'a/', type: 'guide', recommends: ['b'] },
      b: { path: 'b/', type: 'guide', recommends: ['a'] },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    const cycleMsgs = lintMessages(msgs, 'warn').filter((m) => m.message.includes('Cycle in recommends'));
    expect(cycleMsgs.length).toBeGreaterThan(0);
  });

  it('should warn on orphaned packages', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      orphan: { path: 'orphan/', type: 'guide' },
      connected: { path: 'connected/', type: 'guide', depends: ['other'] },
      other: { path: 'other/', type: 'guide' },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    expect(msgs.some((m) => m.message.includes('orphan') && m.message.includes('orphaned'))).toBe(true);
  });

  it('should warn on missing description and category', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      'no-metadata': { path: 'no-meta/', type: 'guide' },
    });

    const { lintMessages: msgs } = buildGraph([{ name: 'test', path: repoPath }]);
    expect(msgs.some((m) => m.message.includes('missing description'))).toBe(true);
    expect(msgs.some((m) => m.message.includes('missing category'))).toBe(true);
  });

  it('should warn on duplicate package IDs across repositories', () => {
    const repo1 = writeRepository(tmpDir, 'repo1.json', {
      duplicate: { path: 'a/', type: 'guide' },
    });
    const repo2 = writeRepository(tmpDir, 'repo2.json', {
      duplicate: { path: 'b/', type: 'guide' },
    });

    const { lintMessages: msgs } = buildGraph([
      { name: 'repo1', path: repo1 },
      { name: 'repo2', path: repo2 },
    ]);
    expect(msgs.some((m) => m.message.includes('Duplicate package ID'))).toBe(true);
  });

  it('should include graph metadata', () => {
    const repoPath = writeRepository(tmpDir, 'repository.json', {
      a: { path: 'a/', type: 'guide', depends: ['b'] },
      b: { path: 'b/', type: 'guide' },
    });

    const { graph } = buildGraph([{ name: 'test', path: repoPath }]);

    expect(graph.metadata.nodeCount).toBe(2);
    expect(graph.metadata.edgeCount).toBe(1);
    expect(graph.metadata.generatedAt).toBeTruthy();
    expect(graph.metadata.repositories).toEqual(['test']);
  });
});
