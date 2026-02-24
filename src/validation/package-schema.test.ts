/**
 * Package Schema Tests (Layer 1)
 *
 * Validates ContentJsonSchema, ManifestJsonSchema, RepositoryJsonSchema,
 * and sub-schemas for the two-file package model.
 */

import {
  ContentJsonSchema,
  ManifestJsonSchema,
  ManifestJsonObjectSchema,
  RepositoryJsonSchema,
  RepositoryEntrySchema,
  DependencyClauseSchema,
  DependencyListSchema,
  AuthorSchema,
  GuideTargetingSchema,
  TestEnvironmentSchema,
  PackageTypeSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  DependencyGraphSchema,
} from '../types/package.schema';
import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';

// ============ ContentJsonSchema ============

describe('ContentJsonSchema', () => {
  it('should accept a minimal valid content.json', () => {
    const result = ContentJsonSchema.safeParse({
      id: 'test-guide',
      title: 'Test guide',
      blocks: [],
    });
    expect(result.success).toBe(true);
  });

  it('should accept content with schemaVersion and blocks', () => {
    const result = ContentJsonSchema.safeParse({
      schemaVersion: '1.1.0',
      id: 'test-guide',
      title: 'Test guide',
      blocks: [{ type: 'markdown', content: '# Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('should reject content without id', () => {
    const result = ContentJsonSchema.safeParse({
      title: 'Test guide',
      blocks: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject content without title', () => {
    const result = ContentJsonSchema.safeParse({
      id: 'test-guide',
      blocks: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject content without blocks', () => {
    const result = ContentJsonSchema.safeParse({
      id: 'test-guide',
      title: 'Test guide',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty id', () => {
    const result = ContentJsonSchema.safeParse({
      id: '',
      title: 'Test guide',
      blocks: [],
    });
    expect(result.success).toBe(false);
  });
});

// ============ ManifestJsonSchema ============

describe('ManifestJsonSchema', () => {
  const minimalGuideManifest = {
    id: 'test-guide',
    type: 'guide',
  };

  it('should accept a minimal guide manifest', () => {
    const result = ManifestJsonSchema.safeParse(minimalGuideManifest);
    expect(result.success).toBe(true);
  });

  it('should apply defaults during parsing', () => {
    const result = ManifestJsonObjectSchema.safeParse(minimalGuideManifest);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.data.repository).toBe('interactive-tutorials');
    expect(result.data.language).toBe('en');
    expect(result.data.startingLocation).toBe('/');
    expect(result.data.depends).toEqual([]);
    expect(result.data.recommends).toEqual([]);
    expect(result.data.suggests).toEqual([]);
    expect(result.data.provides).toEqual([]);
    expect(result.data.conflicts).toEqual([]);
    expect(result.data.replaces).toEqual([]);
    expect(result.data.testEnvironment).toEqual({ tier: 'cloud' });
  });

  it('should accept a fully populated manifest', () => {
    const result = ManifestJsonSchema.safeParse({
      schemaVersion: '1.1.0',
      id: 'prometheus-101',
      type: 'guide',
      repository: 'interactive-tutorials',
      description: 'Learn Prometheus and Grafana',
      language: 'en',
      category: 'data-availability',
      author: { name: 'Enablement Team', team: 'interactive-learning' },
      startingLocation: '/connections',
      depends: ['welcome-to-grafana'],
      recommends: ['first-dashboard'],
      suggests: ['loki-grafana-101', 'prometheus-advanced-queries'],
      provides: ['datasource-configured'],
      conflicts: [],
      replaces: [],
      targeting: { match: { and: [{ urlPrefixIn: ['/connections'] }] } },
      testEnvironment: { tier: 'managed', minVersion: '11.0.0' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject manifest without id', () => {
    const result = ManifestJsonSchema.safeParse({ type: 'guide' });
    expect(result.success).toBe(false);
  });

  it('should reject manifest without type', () => {
    const result = ManifestJsonSchema.safeParse({ id: 'test' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid type values', () => {
    const result = ManifestJsonSchema.safeParse({ id: 'test', type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should accept all valid type values', () => {
    for (const type of ['guide', 'path', 'journey']) {
      const input = type === 'guide' ? { id: 'test', type } : { id: 'test', type, steps: ['step-1'] };
      const result = ManifestJsonSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should require steps when type is "path"', () => {
    const result = ManifestJsonSchema.safeParse({ id: 'test', type: 'path' });
    expect(result.success).toBe(false);
  });

  it('should require steps when type is "journey"', () => {
    const result = ManifestJsonSchema.safeParse({ id: 'test', type: 'journey' });
    expect(result.success).toBe(false);
  });

  it('should accept path with steps', () => {
    const result = ManifestJsonSchema.safeParse({
      id: 'test-path',
      type: 'path',
      steps: ['guide-1', 'guide-2'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject path with empty steps array', () => {
    const result = ManifestJsonSchema.safeParse({
      id: 'test-path',
      type: 'path',
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('should not require steps when type is "guide"', () => {
    const result = ManifestJsonSchema.safeParse({ id: 'test', type: 'guide' });
    expect(result.success).toBe(true);
  });
});

// ============ DependencyClauseSchema ============

describe('DependencyClauseSchema', () => {
  it('should accept a bare string', () => {
    expect(DependencyClauseSchema.safeParse('welcome-to-grafana').success).toBe(true);
  });

  it('should accept an OR-group of strings', () => {
    expect(DependencyClauseSchema.safeParse(['prometheus-101', 'loki-101']).success).toBe(true);
  });

  it('should reject an empty string', () => {
    expect(DependencyClauseSchema.safeParse('').success).toBe(false);
  });

  it('should reject an empty array', () => {
    expect(DependencyClauseSchema.safeParse([]).success).toBe(false);
  });

  it('should reject an array with empty strings', () => {
    expect(DependencyClauseSchema.safeParse(['']).success).toBe(false);
  });
});

// ============ DependencyListSchema ============

describe('DependencyListSchema', () => {
  it('should accept an empty list', () => {
    expect(DependencyListSchema.safeParse([]).success).toBe(true);
  });

  it('should accept AND-only dependencies', () => {
    expect(DependencyListSchema.safeParse(['A', 'B', 'C']).success).toBe(true);
  });

  it('should accept OR-groups within AND', () => {
    expect(DependencyListSchema.safeParse([['A', 'B'], 'C']).success).toBe(true);
  });

  it('should accept mixed clauses', () => {
    expect(DependencyListSchema.safeParse(['A', ['B', 'C'], 'D']).success).toBe(true);
  });
});

// ============ AuthorSchema ============

describe('AuthorSchema', () => {
  it('should accept an empty object', () => {
    expect(AuthorSchema.safeParse({}).success).toBe(true);
  });

  it('should accept name only', () => {
    const result = AuthorSchema.safeParse({ name: 'John' });
    expect(result.success).toBe(true);
  });

  it('should accept team only', () => {
    const result = AuthorSchema.safeParse({ team: 'enablement' });
    expect(result.success).toBe(true);
  });

  it('should accept both name and team', () => {
    const result = AuthorSchema.safeParse({ name: 'John', team: 'enablement' });
    expect(result.success).toBe(true);
  });
});

// ============ GuideTargetingSchema ============

describe('GuideTargetingSchema', () => {
  it('should accept an empty targeting object', () => {
    expect(GuideTargetingSchema.safeParse({}).success).toBe(true);
  });

  it('should accept targeting with match rules', () => {
    const result = GuideTargetingSchema.safeParse({
      match: { and: [{ urlPrefixIn: ['/connections'] }, { targetPlatform: 'oss' }] },
    });
    expect(result.success).toBe(true);
  });

  it('should accept targeting with any match structure', () => {
    const result = GuideTargetingSchema.safeParse({
      match: { or: [{ datasource: 'prometheus' }] },
    });
    expect(result.success).toBe(true);
  });
});

// ============ TestEnvironmentSchema ============

describe('TestEnvironmentSchema', () => {
  it('should accept an empty object', () => {
    expect(TestEnvironmentSchema.safeParse({}).success).toBe(true);
  });

  it('should accept a full test environment', () => {
    const result = TestEnvironmentSchema.safeParse({
      tier: 'managed',
      minVersion: '11.0.0',
      datasets: ['prometheus-sample-metrics'],
      datasources: ['prometheus'],
      plugins: ['grafana-oncall-app'],
    });
    expect(result.success).toBe(true);
  });
});

// ============ PackageTypeSchema ============

describe('PackageTypeSchema', () => {
  it('should accept valid types', () => {
    expect(PackageTypeSchema.safeParse('guide').success).toBe(true);
    expect(PackageTypeSchema.safeParse('path').success).toBe(true);
    expect(PackageTypeSchema.safeParse('journey').success).toBe(true);
  });

  it('should reject invalid types', () => {
    expect(PackageTypeSchema.safeParse('course').success).toBe(false);
    expect(PackageTypeSchema.safeParse('module').success).toBe(false);
    expect(PackageTypeSchema.safeParse('').success).toBe(false);
  });
});

// ============ RepositoryJsonSchema ============

describe('RepositoryJsonSchema', () => {
  it('should accept an empty repository', () => {
    expect(RepositoryJsonSchema.safeParse({}).success).toBe(true);
  });

  it('should accept a valid repository with entries', () => {
    const result = RepositoryJsonSchema.safeParse({
      'welcome-to-grafana': {
        path: 'welcome-to-grafana/',
        title: 'Welcome to Grafana',
        type: 'guide',
      },
      'prometheus-101': {
        path: 'prometheus-grafana-101/',
        title: 'Prometheus & Grafana 101',
        type: 'guide',
        description: 'Learn Prometheus',
        category: 'data-availability',
        depends: ['welcome-to-grafana'],
        provides: ['datasource-configured'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject entries missing required fields', () => {
    const result = RepositoryJsonSchema.safeParse({
      'bad-entry': { path: 'bad/' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept path entries with steps', () => {
    const result = RepositoryJsonSchema.safeParse({
      'getting-started': {
        path: 'getting-started/',
        type: 'path',
        steps: ['welcome', 'first-dashboard'],
      },
    });
    expect(result.success).toBe(true);
  });
});

// ============ RepositoryEntrySchema ============

describe('RepositoryEntrySchema', () => {
  it('should accept a minimal entry', () => {
    const result = RepositoryEntrySchema.safeParse({
      path: 'welcome-to-grafana/',
      type: 'guide',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a fully populated entry', () => {
    const result = RepositoryEntrySchema.safeParse({
      path: 'prometheus-101/',
      title: 'Prometheus & Grafana 101',
      description: 'Learn Prometheus and Grafana',
      category: 'data-availability',
      type: 'guide',
      startingLocation: '/connections',
      depends: ['welcome-to-grafana'],
      recommends: ['first-dashboard'],
      suggests: [['loki-101', 'prometheus-advanced']],
      provides: ['datasource-configured'],
      conflicts: [],
      replaces: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject entries without path', () => {
    const result = RepositoryEntrySchema.safeParse({ type: 'guide' });
    expect(result.success).toBe(false);
  });

  it('should reject entries without type', () => {
    const result = RepositoryEntrySchema.safeParse({ path: 'foo/' });
    expect(result.success).toBe(false);
  });
});

// ============ Graph Schemas ============

describe('GraphNodeSchema', () => {
  it('should accept a minimal node', () => {
    const result = GraphNodeSchema.safeParse({
      id: 'test',
      repository: 'interactive-tutorials',
      type: 'guide',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a virtual node', () => {
    const result = GraphNodeSchema.safeParse({
      id: 'datasource-configured',
      repository: '',
      type: 'guide',
      virtual: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('GraphEdgeSchema', () => {
  it('should accept a valid edge', () => {
    const result = GraphEdgeSchema.safeParse({
      source: 'prometheus-101',
      target: 'welcome-to-grafana',
      type: 'depends',
    });
    expect(result.success).toBe(true);
  });

  it('should accept all edge types', () => {
    const types = ['depends', 'recommends', 'suggests', 'provides', 'conflicts', 'replaces', 'steps'];
    for (const type of types) {
      const result = GraphEdgeSchema.safeParse({ source: 'a', target: 'b', type });
      expect(result.success).toBe(true);
    }
  });
});

describe('DependencyGraphSchema', () => {
  it('should accept a valid graph', () => {
    const result = DependencyGraphSchema.safeParse({
      nodes: [{ id: 'test', repository: 'bundled', type: 'guide' }],
      edges: [{ source: 'test', target: 'other', type: 'depends' }],
      metadata: {
        generatedAt: '2026-02-24T00:00:00Z',
        repositories: ['bundled'],
        nodeCount: 1,
        edgeCount: 1,
      },
    });
    expect(result.success).toBe(true);
  });
});

// ============ Cross-file ID consistency ============

describe('Cross-file ID consistency', () => {
  it('should validate matching IDs between content and manifest', () => {
    const content = ContentJsonSchema.parse({
      id: 'my-guide',
      title: 'My guide',
      blocks: [],
    });

    const manifest = ManifestJsonObjectSchema.parse({
      id: 'my-guide',
      type: 'guide',
    });

    expect(content.id).toBe(manifest.id);
  });

  it('should detect mismatched IDs', () => {
    const content = ContentJsonSchema.parse({
      id: 'guide-a',
      title: 'Guide A',
      blocks: [],
    });

    const manifest = ManifestJsonObjectSchema.parse({
      id: 'guide-b',
      type: 'guide',
    });

    expect(content.id).not.toBe(manifest.id);
  });
});

// ============ CURRENT_SCHEMA_VERSION ============

describe('CURRENT_SCHEMA_VERSION', () => {
  it('should be 1.1.0', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('1.1.0');
  });
});
