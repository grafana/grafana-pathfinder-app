/**
 * Architecture Invariant Tests
 *
 * Ratchet tests that document the current state of the codebase's
 * architectural boundaries and prevent regressions. These tests do NOT
 * require any production code changes — they enforce constraints by
 * failing CI when new violations are introduced.
 *
 * Ratchet mechanism: Each test has an allowlist of known violations.
 * The allowlist can only shrink (violations removed as they're fixed),
 * never grow. New violations cause test failure.
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateGuideFromString } from './index';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(__dirname, '..');

/**
 * Tier model: lower number = more foundational.
 * A file in tier N may import from tier N or any tier < N.
 * Importing from tier > N is a violation.
 */
const TIER_MAP: Record<string, number> = {
  types: 0,
  constants: 0,
  lib: 1,
  security: 1,
  styles: 1,
  'context-engine': 2,
  'docs-retrieval': 2,
  'interactive-engine': 2,
  'requirements-manager': 2,
  'learning-paths': 2,
  validation: 2,
  integrations: 3,
  components: 4,
  pages: 4,
};

const TIER_2_ENGINES = [
  'context-engine',
  'docs-retrieval',
  'interactive-engine',
  'requirements-manager',
  'learning-paths',
  'validation',
];

const EXCLUDED_TOP_LEVEL = new Set(['test-utils', 'cli', 'bundled-interactives', 'img', 'locales']);

function isTestFile(filePath: string): boolean {
  const relative = path.relative(SRC_DIR, filePath);
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(relative) ||
    relative.startsWith(`test-utils${path.sep}`) ||
    relative.includes(`${path.sep}__tests__${path.sep}`)
  );
}

function collectSourceFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relDir = path.relative(SRC_DIR, fullPath);
        const topLevel = relDir.split(path.sep)[0];
        if (topLevel && EXCLUDED_TOP_LEVEL.has(topLevel)) {
          continue;
        }
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }
  walk(SRC_DIR);
  return files;
}

interface FileImports {
  file: string;
  relPath: string;
  topLevelDir: string | null;
  imports: string[];
}

function getTopLevelDir(relPath: string): string | null {
  const segments = relPath.split(path.sep);
  if (segments.length <= 1) {
    return null;
  }
  return segments[0] ?? null;
}

function extractRelativeImports(content: string): string[] {
  const specifiers = new Set<string>();

  // import/export ... from './...'
  const fromRegex = /from\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = fromRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  // import './...' (side-effect)
  const sideEffectRegex = /^\s*import\s+['"](\.[^'"]+)['"]/gm;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  // require('./...')
  const requireRegex = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function resolveImportToRelative(fileDir: string, importPath: string): string | null {
  const resolved = path.resolve(fileDir, importPath);
  const relative = path.relative(SRC_DIR, resolved);
  if (relative.startsWith('..')) {
    return null;
  }
  return relative;
}

function getTargetTopLevel(resolvedRelative: string): string | null {
  const segments = resolvedRelative.split(path.sep);
  return segments[0] ?? null;
}

// Cache parsed file data across tests
let cachedFileImports: FileImports[] | undefined;

function getAllFileImports(): FileImports[] {
  if (cachedFileImports) {
    return cachedFileImports;
  }
  const files = collectSourceFiles();
  cachedFileImports = files.map((file) => {
    const relPath = path.relative(SRC_DIR, file);
    const topLevelDir = getTopLevelDir(relPath);
    const content = fs.readFileSync(file, 'utf-8');
    const imports = extractRelativeImports(content);
    return { file, relPath, topLevelDir, imports };
  });
  return cachedFileImports;
}

// ---------------------------------------------------------------------------
// Test 1: Import graph boundaries (vertical tier enforcement)
// ---------------------------------------------------------------------------

describe('Import graph: vertical tier enforcement', () => {
  /**
   * Ratchet allowlist of known vertical tier violations.
   * Format: "source/file/path.ts -> targetTopLevelDir"
   *
   * This list should only shrink as violations are resolved.
   * Adding new entries means the architecture is degrading.
   */
  const ALLOWED_VERTICAL_VIOLATIONS = new Set([
    'docs-retrieval/content-renderer.tsx -> integrations',
    'docs-retrieval/components/interactive/interactive-step.tsx -> integrations',
  ]);

  it('should not contain upward-tier imports beyond the ratchet allowlist', () => {
    const allFiles = getAllFileImports();
    const violations = new Set<string>();

    for (const { file, relPath, topLevelDir, imports } of allFiles) {
      if (isTestFile(file)) {
        continue;
      }
      if (!topLevelDir) {
        continue;
      }

      const sourceTier = TIER_MAP[topLevelDir];
      if (sourceTier === undefined) {
        continue;
      }

      const fileDir = path.dirname(file);

      for (const imp of imports) {
        const resolved = resolveImportToRelative(fileDir, imp);
        if (!resolved) {
          continue;
        }
        const targetTopLevel = getTargetTopLevel(resolved);
        if (!targetTopLevel) {
          continue;
        }
        const targetTier = TIER_MAP[targetTopLevel];
        if (targetTier === undefined) {
          continue;
        }
        if (targetTier > sourceTier) {
          violations.add(`${relPath} -> ${targetTopLevel}`);
        }
      }
    }

    const newViolations = [...violations].filter((v) => !ALLOWED_VERTICAL_VIOLATIONS.has(v));

    expect(newViolations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Inter-engine isolation (Tier 2 lateral imports)
// ---------------------------------------------------------------------------

describe('Inter-engine isolation: Tier 2 lateral imports', () => {
  /**
   * Ratchet allowlist of known Tier 2 lateral violations.
   * Format: "source/file/path.ts -> targetEngine"
   *
   * This list should only shrink as violations are resolved (Phase 2).
   * Adding new entries means inter-engine coupling is increasing.
   */
  const ALLOWED_LATERAL_VIOLATIONS = new Set([
    // Cluster A: interactive-engine <-> requirements-manager cycle
    'interactive-engine/interactive.hook.ts -> requirements-manager',
    'interactive-engine/use-sequential-step-state.hook.ts -> requirements-manager',
    'requirements-manager/requirements-checker.utils.ts -> context-engine',
    'requirements-manager/step-checker.hook.ts -> interactive-engine',
    // Cluster B: context-engine -> docs-retrieval
    'context-engine/context.service.ts -> docs-retrieval',
    // docs-retrieval orchestrates interactive/requirements (many touch points)
    'docs-retrieval/content-renderer.tsx -> requirements-manager',
    'docs-retrieval/json-parser.ts -> validation',
    'docs-retrieval/content-fetcher.ts -> validation',
    'docs-retrieval/components/interactive/interactive-section.tsx -> interactive-engine',
    'docs-retrieval/components/interactive/interactive-section.tsx -> requirements-manager',
    'docs-retrieval/components/interactive/interactive-quiz.tsx -> requirements-manager',
    'docs-retrieval/components/interactive/interactive-multi-step.tsx -> requirements-manager',
    'docs-retrieval/components/interactive/interactive-multi-step.tsx -> interactive-engine',
    'docs-retrieval/components/interactive/interactive-guided.tsx -> requirements-manager',
    'docs-retrieval/components/interactive/interactive-guided.tsx -> interactive-engine',
    'docs-retrieval/components/interactive/interactive-conditional.tsx -> interactive-engine',
    'docs-retrieval/components/interactive/interactive-step.tsx -> requirements-manager',
    'docs-retrieval/components/interactive/interactive-step.tsx -> interactive-engine',
  ]);

  it('should not introduce new lateral imports between Tier 2 engines', () => {
    const allFiles = getAllFileImports();
    const violations = new Set<string>();

    for (const { file, relPath, topLevelDir, imports } of allFiles) {
      if (isTestFile(file)) {
        continue;
      }
      if (!topLevelDir || !TIER_2_ENGINES.includes(topLevelDir)) {
        continue;
      }

      const fileDir = path.dirname(file);

      for (const imp of imports) {
        const resolved = resolveImportToRelative(fileDir, imp);
        if (!resolved) {
          continue;
        }
        const targetTopLevel = getTargetTopLevel(resolved);
        if (!targetTopLevel) {
          continue;
        }
        if (!TIER_2_ENGINES.includes(targetTopLevel)) {
          continue;
        }
        if (targetTopLevel === topLevelDir) {
          continue;
        }

        violations.add(`${relPath} -> ${targetTopLevel}`);
      }
    }

    const newViolations = [...violations].filter((v) => !ALLOWED_LATERAL_VIOLATIONS.has(v));

    expect(newViolations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Barrel export discipline
// ---------------------------------------------------------------------------

describe('Barrel export discipline', () => {
  /**
   * Ratchet allowlist of known barrel bypass violations.
   * Format: "consumer/file/path.ts -> engine/internal/path"
   *
   * External consumers should import from the engine barrel (index.ts),
   * not from internal files. This list should only shrink.
   */
  const ALLOWED_BARREL_VIOLATIONS = new Set([
    'integrations/assistant-integration/tools/grafana-context.tool.ts -> context-engine/context.service',
    'components/docs-panel/link-handler.hook.ts -> docs-retrieval/learning-journey-helpers',
    'components/docs-panel/docs-panel.tsx -> docs-retrieval/learning-journey-helpers',
    'integrations/assistant-integration/AssistantBlockWrapper.tsx -> docs-retrieval/json-parser',
    'integrations/assistant-integration/AssistantBlockWrapper.tsx -> docs-retrieval/components/docs',
    'components/block-editor/BlockPreview.tsx -> docs-retrieval/json-parser',
    'components/block-editor/BlockPreview.tsx -> docs-retrieval/content-renderer',
    'components/block-editor/BlockEditorTour.tsx -> interactive-engine/navigation-manager',
    'components/LearningPaths/badge-utils.ts -> learning-paths/paths-data',
    'components/LearningPaths/MyLearningTab.tsx -> learning-paths/paths-data',
  ]);

  it('should not introduce new direct imports that bypass Tier 2 engine barrels', () => {
    const allFiles = getAllFileImports();
    const violations = new Set<string>();

    const enginesWithBarrels = TIER_2_ENGINES.filter((engine) => fs.existsSync(path.join(SRC_DIR, engine, 'index.ts')));

    for (const { file, relPath, topLevelDir, imports } of allFiles) {
      if (isTestFile(file)) {
        continue;
      }

      const fileDir = path.dirname(file);

      for (const imp of imports) {
        const resolved = resolveImportToRelative(fileDir, imp);
        if (!resolved) {
          continue;
        }

        const segments = resolved.split(path.sep);
        const targetTopLevel = segments[0];
        if (!targetTopLevel || !enginesWithBarrels.includes(targetTopLevel)) {
          continue;
        }

        // Internal imports within the same engine are fine
        if (topLevelDir === targetTopLevel) {
          continue;
        }

        // More than one segment means it's importing an internal file
        if (segments.length > 1) {
          violations.add(`${relPath} -> ${resolved}`);
        }
      }
    }

    const newViolations = [...violations].filter((v) => !ALLOWED_BARREL_VIOLATIONS.has(v));

    expect(newViolations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Bundled content validation
// ---------------------------------------------------------------------------

describe('Bundled content validation', () => {
  it('validates all bundled JSON guides pass schema validation', () => {
    const bundledDir = path.resolve(SRC_DIR, 'bundled-interactives');
    const guideFiles = fs.readdirSync(bundledDir).filter((f) => f.endsWith('.json') && f !== 'index.json');

    expect(guideFiles.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const file of guideFiles) {
      const content = fs.readFileSync(path.join(bundledDir, file), 'utf-8');
      const result = validateGuideFromString(content);
      if (!result.isValid) {
        failures.push(file);
      }
    }

    expect(failures).toEqual([]);
  });
});
