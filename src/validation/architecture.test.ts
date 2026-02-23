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
  SRC_DIR,
  TIER_2_ENGINES,
  TIER_MAP,
  getAllFileImports,
  getTargetTopLevel,
  isTestFile,
  resolveImportToRelative,
} from './import-graph';

// ---------------------------------------------------------------------------
// Test 0: Tier map completeness (meta-test)
// ---------------------------------------------------------------------------

describe('Tier map completeness', () => {
  it('should account for every top-level source directory', () => {
    const topLevelDirs = fs
      .readdirSync(SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const unaccounted = topLevelDirs.filter((dir) => TIER_MAP[dir] === undefined && !EXCLUDED_TOP_LEVEL.has(dir));

    if (unaccounted.length > 0) {
      fail(
        `Unaccounted top-level directories: ${unaccounted.join(', ')}\n\n` +
          `Every directory under src/ must appear in either TIER_MAP (with a tier number) ` +
          `or EXCLUDED_TOP_LEVEL. Add the missing directories to the appropriate constant ` +
          `in src/validation/import-graph.ts to ensure architectural boundary enforcement covers them.`
      );
    }
  });
});

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

    if (newViolations.length > 0) {
      fail(
        `New vertical tier violations detected:\n${newViolations.map((v) => `  - ${v}`).join('\n')}\n\n` +
          `Files in tier N may only import from tier N or lower. ` +
          `If this import is architecturally justified, add it to ALLOWED_VERTICAL_VIOLATIONS ` +
          `with a comment explaining why. Otherwise, restructure the import to respect the tier boundary. ` +
          `See TIER_MAP in src/validation/import-graph.ts for the tier assignments.`
      );
    }

    const staleEntries = [...ALLOWED_VERTICAL_VIOLATIONS].filter((entry) => !violations.has(entry));
    if (staleEntries.length > 0) {
      fail(
        `Stale entries in ALLOWED_VERTICAL_VIOLATIONS (violation was fixed — remove the entry):\n` +
          staleEntries.map((e) => `  - ${e}`).join('\n')
      );
    }
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

    if (newViolations.length > 0) {
      fail(
        `New Tier 2 lateral import violations detected:\n${newViolations.map((v) => `  - ${v}`).join('\n')}\n\n` +
          `Tier 2 engines must not import from other Tier 2 engines unless explicitly allowed. ` +
          `If this cross-engine import is architecturally justified, add it to ALLOWED_LATERAL_VIOLATIONS ` +
          `with a comment explaining why. Otherwise, extract the shared dependency to src/types/ or src/lib/, ` +
          `or use dependency injection.`
      );
    }

    const staleEntries = [...ALLOWED_LATERAL_VIOLATIONS].filter((entry) => !violations.has(entry));
    if (staleEntries.length > 0) {
      fail(
        `Stale entries in ALLOWED_LATERAL_VIOLATIONS (violation was fixed — remove the entry):\n` +
          staleEntries.map((e) => `  - ${e}`).join('\n')
      );
    }
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

        if (topLevelDir === targetTopLevel) {
          continue;
        }

        // Resolved path with >1 segment targets an internal file, not the barrel
        if (segments.length > 1) {
          violations.add(`${relPath} -> ${resolved}`);
        }
      }
    }

    const newViolations = [...violations].filter((v) => !ALLOWED_BARREL_VIOLATIONS.has(v));

    if (newViolations.length > 0) {
      fail(
        `New barrel bypass violations detected:\n${newViolations.map((v) => `  - ${v}`).join('\n')}\n\n` +
          `External consumers should import from the engine's barrel export (index.ts), ` +
          `not from internal files. If the symbol is not yet exported from the barrel, ` +
          `add it to the engine's index.ts. If the barrel bypass is architecturally justified, ` +
          `add it to ALLOWED_BARREL_VIOLATIONS with a comment explaining why.`
      );
    }

    const staleEntries = [...ALLOWED_BARREL_VIOLATIONS].filter((entry) => !violations.has(entry));
    if (staleEntries.length > 0) {
      fail(
        `Stale entries in ALLOWED_BARREL_VIOLATIONS (violation was fixed — remove the entry):\n` +
          staleEntries.map((e) => `  - ${e}`).join('\n')
      );
    }
  });
});
