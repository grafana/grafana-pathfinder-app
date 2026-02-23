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
 * never grow. New violations cause test failure, and stale allowlist
 * entries (violations that have been fixed) also cause test failure.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  EXCLUDED_TOP_LEVEL,
  ROOT_LEVEL_ALLOWED_FILES,
  SRC_DIR,
  TIER_2_ENGINES,
  TIER_MAP,
  assertRatchet,
  getAllFileImports,
  getRootLevelSourceFiles,
  getTargetTopLevel,
  isTestFile,
  resolveImportToRelative,
  toPosixPath,
} from './import-graph';

interface ResolvedImportContext {
  relPath: string;
  topLevelDir: string | null;
  resolved: string;
  targetTopLevel: string;
}

/**
 * Iterates every non-test source file's imports, resolves each to a
 * src-relative path, and calls getViolationKey to determine if it
 * constitutes a violation.
 *
 * Filtered before the callback sees them:
 * - Test files (*.test.ts, *.spec.ts, test-utils/*, __tests__/*)
 * - Imports that resolve outside SRC_DIR (external/unresolvable)
 * - Imports whose resolved path has no extractable top-level directory
 *
 * Root-level files (e.g. module.tsx) are included but have
 * topLevelDir=null, so callbacks must handle that case.
 *
 * Known limitation: root-level files' imports are invisible to tier
 * enforcement because all three constraint callbacks return null when
 * topLevelDir is null. Today only module.tsx and constants.ts live at
 * root, so the practical risk is low. If root-level files proliferate,
 * consider assigning them explicit tiers via a parallel map.
 */
function collectViolations(getViolationKey: (ctx: ResolvedImportContext) => string | null): Set<string> {
  const allFiles = getAllFileImports();
  const violations = new Set<string>();

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

      const targetTopLevel = getTargetTopLevel(resolved);
      if (!targetTopLevel) {
        continue;
      }

      const violationKey = getViolationKey({ relPath, topLevelDir, resolved, targetTopLevel });
      if (violationKey) {
        violations.add(violationKey);
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Ratchet allowlists (policy — edit these as violations are fixed)
// ---------------------------------------------------------------------------

/**
 * Known vertical tier violations.
 * Format: "source/file/path.ts -> targetTopLevelDir"
 *
 * This list should only shrink as violations are resolved.
 * Adding new entries means the architecture is degrading.
 */
const ALLOWED_VERTICAL_VIOLATIONS = new Set([
  'docs-retrieval/content-renderer.tsx -> integrations',
  'docs-retrieval/components/interactive/interactive-step.tsx -> integrations',
  // Existing cross-domain persistence dependency (legacy coupling)
  'lib/user-storage.ts -> learning-paths',
]);

/**
 * Known Tier 2 lateral violations.
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
  // Additional pre-existing cross-engine imports uncovered by AST parsing
  'docs-retrieval/learning-journey-helpers.ts -> learning-paths',
  'requirements-manager/requirements-checker.hook.ts -> context-engine',
  'requirements-manager/step-checker.hook.ts -> context-engine',
]);

/**
 * Known barrel bypass violations.
 * Format: "consumer/file/path.ts -> engine/internal/path"
 *
 * External consumers should import from the engine barrel (index.ts),
 * not from internal files. This list should only shrink.
 *
 * Phase 4a cleared all 15 original entries by re-exporting from barrels
 * and updating consumer import paths.
 */
const ALLOWED_BARREL_VIOLATIONS = new Set<string>([]);

// Violation key formatters — kept adjacent to allowlists so format changes
// are visible in the same diff as allowlist updates.
const directionKey = (relPath: string, targetTopLevel: string) => `${toPosixPath(relPath)} -> ${targetTopLevel}`;

const barrelKey = (relPath: string, resolved: string) => `${toPosixPath(relPath)} -> ${toPosixPath(resolved)}`;

// ---------------------------------------------------------------------------
// Tests (mechanism — edit these only when adding new constraint categories)
// ---------------------------------------------------------------------------

describe('Tier map completeness', () => {
  it('should account for every top-level source directory', () => {
    const topLevelDirs = fs
      .readdirSync(SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const unaccounted = topLevelDirs.filter((dir) => TIER_MAP[dir] === undefined && !EXCLUDED_TOP_LEVEL.has(dir));

    if (unaccounted.length > 0) {
      throw new Error(
        `Unaccounted top-level directories: ${unaccounted.join(', ')}\n\n` +
          `Every directory under src/ must appear in either TIER_MAP (with a tier number) ` +
          `or EXCLUDED_TOP_LEVEL. Add the missing directories to the appropriate constant ` +
          `in src/validation/import-graph.ts to ensure architectural boundary enforcement covers them.`
      );
    }
  });

  it('should keep root-level source files explicitly allowlisted', () => {
    const rootLevelSourceFiles = getRootLevelSourceFiles().map((file) => toPosixPath(file));
    const unaccounted = rootLevelSourceFiles.filter((file) => !ROOT_LEVEL_ALLOWED_FILES.has(file));

    if (unaccounted.length > 0) {
      throw new Error(
        `Unaccounted root-level source files in src/: ${unaccounted.join(', ')}\n\n` +
          `Root-level files are a deliberate exception and must be explicitly reviewed. ` +
          `Add new root-level files to ROOT_LEVEL_ALLOWED_FILES in src/validation/import-graph.ts ` +
          `with a comment describing why they are allowed to live at src root.`
      );
    }

    const staleEntries = [...ROOT_LEVEL_ALLOWED_FILES].filter((entry) => !rootLevelSourceFiles.includes(entry));
    if (staleEntries.length > 0) {
      throw new Error(
        `Stale entries in ROOT_LEVEL_ALLOWED_FILES (file no longer exists — remove the entry):\n` +
          staleEntries.map((entry) => `  - ${entry}`).join('\n')
      );
    }
  });
});

describe('Import graph: vertical tier enforcement', () => {
  it('should not contain upward-tier imports beyond the ratchet allowlist', () => {
    const violations = collectViolations(({ relPath, topLevelDir, targetTopLevel }) => {
      if (!topLevelDir) {
        return null;
      }

      const sourceTier = TIER_MAP[topLevelDir];
      const targetTier = TIER_MAP[targetTopLevel];
      if (sourceTier === undefined || targetTier === undefined || targetTier <= sourceTier) {
        return null;
      }

      return directionKey(relPath, targetTopLevel);
    });

    assertRatchet(
      violations,
      ALLOWED_VERTICAL_VIOLATIONS,
      'vertical tier violations',
      'ALLOWED_VERTICAL_VIOLATIONS',
      `Files in tier N may only import from tier N or lower. ` +
        `If this import is architecturally justified, add it to ALLOWED_VERTICAL_VIOLATIONS ` +
        `with a comment explaining why. Otherwise, restructure the import to respect the tier boundary. ` +
        `See TIER_MAP in src/validation/import-graph.ts for the tier assignments.`
    );
  });
});

describe('Inter-engine isolation: Tier 2 lateral imports', () => {
  it('should not introduce new lateral imports between Tier 2 engines', () => {
    const violations = collectViolations(({ relPath, topLevelDir, targetTopLevel }) => {
      if (!topLevelDir || !TIER_2_ENGINES.includes(topLevelDir)) {
        return null;
      }
      if (!TIER_2_ENGINES.includes(targetTopLevel) || targetTopLevel === topLevelDir) {
        return null;
      }

      return directionKey(relPath, targetTopLevel);
    });

    assertRatchet(
      violations,
      ALLOWED_LATERAL_VIOLATIONS,
      'Tier 2 lateral import violations',
      'ALLOWED_LATERAL_VIOLATIONS',
      `Tier 2 engines must not import from other Tier 2 engines unless explicitly allowed. ` +
        `If this cross-engine import is architecturally justified, add it to ALLOWED_LATERAL_VIOLATIONS ` +
        `with a comment explaining why. Otherwise, extract the shared dependency to src/types/ or src/lib/, ` +
        `or use dependency injection.`
    );
  });
});

describe('Barrel export discipline', () => {
  it('should have a barrel export (index.ts) for every Tier 2 engine', () => {
    const missingBarrels = TIER_2_ENGINES.filter((engine) => !fs.existsSync(path.join(SRC_DIR, engine, 'index.ts')));
    if (missingBarrels.length > 0) {
      throw new Error(
        `Tier 2 engines missing barrel exports (index.ts): ${missingBarrels.join(', ')}\n\n` +
          `Every Tier 2 engine must have an index.ts barrel file that re-exports its public API. ` +
          `Create the missing index.ts or, if the engine is intentionally internal-only, ` +
          `document the exception.`
      );
    }
  });

  it('should not introduce new direct imports that bypass Tier 2 engine barrels', () => {
    const enginesWithBarrels = TIER_2_ENGINES.filter((engine) => fs.existsSync(path.join(SRC_DIR, engine, 'index.ts')));
    const violations = collectViolations(({ relPath, topLevelDir, resolved, targetTopLevel }) => {
      if (!enginesWithBarrels.includes(targetTopLevel) || topLevelDir === targetTopLevel) {
        return null;
      }

      const segments = toPosixPath(resolved).split('/');
      const isBarrelImport = segments.length <= 1 || (segments.length === 2 && segments[1] === 'index');
      if (isBarrelImport) {
        return null;
      }

      return barrelKey(relPath, resolved);
    });

    assertRatchet(
      violations,
      ALLOWED_BARREL_VIOLATIONS,
      'barrel bypass violations',
      'ALLOWED_BARREL_VIOLATIONS',
      `External consumers must import from the engine's barrel (index.ts), not internal files.\n` +
        `Each violation above has the format "consumer/path.ts -> engine/internal/path".\n\n` +
        `To fix:\n` +
        `  1. Parse the engine name (first segment after "->") and internal path (remainder)\n` +
        `  2. Open src/<engine>/index.ts and add a re-export for the needed symbol:\n` +
        `       export { YourSymbol } from './<internal/path>';\n` +
        `  3. Update the consumer's import to use the barrel:\n` +
        `       import { YourSymbol } from '<relative-path>/<engine>';\n\n` +
        `Example: for "components/Foo.tsx -> docs-retrieval/json-parser", add\n` +
        `  export { parseJsonGuide } from './json-parser';  to src/docs-retrieval/index.ts\n` +
        `then change the consumer to: import { parseJsonGuide } from '../../docs-retrieval';\n\n` +
        `If the barrel bypass is architecturally justified, add it to ALLOWED_BARREL_VIOLATIONS ` +
        `with a comment explaining why.`
    );
  });
});

describe('Architecture ratchet progress', () => {
  it('should report current violation counts', () => {
    console.log(
      `[architecture-ratchet] vertical=${ALLOWED_VERTICAL_VIOLATIONS.size}` +
        ` lateral=${ALLOWED_LATERAL_VIOLATIONS.size}` +
        ` barrel=${ALLOWED_BARREL_VIOLATIONS.size}`
    );
  });
});
