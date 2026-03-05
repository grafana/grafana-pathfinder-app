/**
 * Bundled Repository Integration Tests (Layer 1 + Layer 2)
 *
 * Validates the actual bundled repository against the package schema,
 * ensures repository.json is consistent with the package directories,
 * and verifies the dependency graph is well-formed.
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildRepository } from '../cli/commands/build-repository';
import { discoverBundledGuideFiles } from '../cli/utils/file-loader';
import { RepositoryJsonSchema, ManifestJsonSchema, ContentJsonSchema } from '../types/package.schema';
import type { DependencyList, RepositoryJson } from '../types/package.types';
import { validatePackageTree } from './validate-package';

const BUNDLED_DIR = path.resolve(__dirname, '../bundled-interactives');
const REPOSITORY_PATH = path.join(BUNDLED_DIR, 'repository.json');

describe('Bundled repository', () => {
  describe('repository.json', () => {
    let repositoryJson: RepositoryJson;

    beforeAll(() => {
      const raw = fs.readFileSync(REPOSITORY_PATH, 'utf-8');
      repositoryJson = JSON.parse(raw) as RepositoryJson;
    });

    it('should exist on disk', () => {
      expect(fs.existsSync(REPOSITORY_PATH)).toBe(true);
    });

    it('should be valid against RepositoryJsonSchema', () => {
      const result = RepositoryJsonSchema.safeParse(repositoryJson);
      if (!result.success) {
        throw new Error(
          `repository.json schema validation failed:\n${result.error.issues.map((i) => i.message).join('\n')}`
        );
      }
      expect(result.success).toBe(true);
    });

    it('should contain at least the 7 user-facing guides', () => {
      const expectedGuides = [
        'welcome-to-grafana',
        'welcome-to-grafana-cloud',
        'prometheus-grafana-101',
        'prometheus-advanced-queries',
        'loki-grafana-101',
        'first-dashboard',
        'first-dashboard-cloud',
      ];
      for (const id of expectedGuides) {
        expect(repositoryJson[id]).toBeDefined();
      }
    });

    it('should have a path field for every entry', () => {
      for (const [, entry] of Object.entries(repositoryJson)) {
        expect(entry.path).toBeTruthy();
        expect(entry.path).toMatch(/\/$/);
      }
    });

    it('should have a type for every entry', () => {
      for (const [, entry] of Object.entries(repositoryJson)) {
        expect(['guide', 'path', 'journey']).toContain(entry.type);
      }
    });
  });

  describe('repository.json freshness', () => {
    it('should match a freshly generated repository', () => {
      const { repository: freshRepo, errors } = buildRepository(BUNDLED_DIR);
      expect(errors).toHaveLength(0);

      const committed = JSON.parse(fs.readFileSync(REPOSITORY_PATH, 'utf-8'));
      expect(freshRepo).toEqual(committed);
    });
  });

  describe('package directories', () => {
    it('should all pass package validation', () => {
      const results = validatePackageTree(BUNDLED_DIR);
      expect(results.size).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const [dirName, result] of results) {
        if (!result.isValid) {
          const msgs = result.errors.map((e) => e.message).join('; ');
          failures.push(`${dirName}: ${msgs}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`Package validation failures:\n${failures.join('\n')}`);
      }
    });

    it('should each have both content.json and manifest.json', () => {
      const packageDirs = discoverBundledGuideFiles(BUNDLED_DIR)
        .filter((g) => g.displayName.endsWith('/content.json'))
        .map((g) => path.dirname(g.filePath));

      expect(packageDirs.length).toBeGreaterThan(0);

      for (const dir of packageDirs) {
        const manifestPath = path.join(dir, 'manifest.json');
        expect(fs.existsSync(manifestPath)).toBe(true);
      }
    });

    it('should have consistent IDs between content.json and manifest.json', () => {
      const packageDirs = discoverBundledGuideFiles(BUNDLED_DIR)
        .filter((g) => g.displayName.endsWith('/content.json'))
        .map((g) => path.dirname(g.filePath));

      for (const dir of packageDirs) {
        const manifestPath = path.join(dir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
          continue;
        }

        const content = ContentJsonSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf-8')));
        const manifest = ManifestJsonSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));

        expect(manifest.id).toBe(content.id);
      }
    });
  });

  describe('dependency graph integrity', () => {
    let repositoryJson: RepositoryJson;

    beforeAll(() => {
      repositoryJson = JSON.parse(fs.readFileSync(REPOSITORY_PATH, 'utf-8')) as RepositoryJson;
    });

    it('should have no broken dependency references', () => {
      const allIds = new Set(Object.keys(repositoryJson));
      const allProvides = new Set<string>();

      for (const entry of Object.values(repositoryJson)) {
        for (const cap of entry.provides ?? []) {
          allProvides.add(cap);
        }
      }

      const broken: string[] = [];
      for (const [id, entry] of Object.entries(repositoryJson)) {
        const checkDeps = (deps: DependencyList | undefined, field: string) => {
          if (!deps) {
            return;
          }
          for (const clause of deps) {
            const refs = Array.isArray(clause) ? clause : [clause];
            for (const ref of refs) {
              if (typeof ref === 'string' && !allIds.has(ref) && !allProvides.has(ref)) {
                broken.push(`${id}.${field}: "${ref}" not found`);
              }
            }
          }
        };

        checkDeps(entry.depends, 'depends');
        checkDeps(entry.recommends, 'recommends');
        checkDeps(entry.suggests, 'suggests');
      }

      if (broken.length > 0) {
        throw new Error(`Broken dependency references:\n${broken.join('\n')}`);
      }
    });

    it('should have no cycles in depends chains', () => {
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const cycles: string[] = [];

      function dfs(id: string, chain: string[]): void {
        if (inStack.has(id)) {
          const cycleStart = chain.indexOf(id);
          cycles.push(chain.slice(cycleStart).concat(id).join(' → '));
          return;
        }
        if (visited.has(id)) {
          return;
        }

        visited.add(id);
        inStack.add(id);

        const entry = repositoryJson[id];
        if (entry?.depends) {
          for (const clause of entry.depends) {
            const refs = Array.isArray(clause) ? clause : [clause];
            for (const ref of refs) {
              if (typeof ref === 'string') {
                dfs(ref, [...chain, id]);
              }
            }
          }
        }

        inStack.delete(id);
      }

      for (const id of Object.keys(repositoryJson)) {
        dfs(id, []);
      }

      if (cycles.length > 0) {
        throw new Error(`Dependency cycles detected:\n${cycles.join('\n')}`);
      }
    });

    it('should have descriptions for user-facing guides', () => {
      const userFacingIds = [
        'welcome-to-grafana',
        'welcome-to-grafana-cloud',
        'prometheus-grafana-101',
        'prometheus-advanced-queries',
        'loki-grafana-101',
        'first-dashboard',
        'first-dashboard-cloud',
      ];

      for (const id of userFacingIds) {
        const entry = repositoryJson[id];
        expect(entry).toBeDefined();
        expect(entry?.description).toBeTruthy();
        expect(entry?.category).toBeTruthy();
      }
    });
  });
});
