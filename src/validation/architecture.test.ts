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
  getSourceTier,
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
 * topLevelDir=null. The vertical-tier callback uses getSourceTier() to
 * resolve the source tier via ROOT_LEVEL_TIER_MAP for those files; the
 * lateral and barrel callbacks remain a no-op for root files because
 * those constraints don't apply to non-engine source files.
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
  // Existing cross-domain persistence dependency (legacy coupling)
  'lib/user-storage.ts -> learning-paths',
  // Terminal requirement check needs to query terminal connection status from the integrations layer.
  // The dynamic import minimizes coupling and makes terminal code tree-shakeable when disabled.
  'requirements-manager/checks/terminal.ts -> integrations',
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
  'requirements-manager/checks/grafana-api.ts -> context-engine',
  'requirements-manager/step-checker.hook.ts -> interactive-engine',
  // Cluster B: context-engine -> docs-retrieval
  'context-engine/context.service.ts -> docs-retrieval',
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
          `Root-level files bypass top-level tier enforcement, so each one must be explicitly ` +
          `tiered. Add an entry to ROOT_LEVEL_TIER_MAP in src/validation/import-graph.ts mapping ` +
          `the file to its tier number (matching the TIER_MAP scale: 0 = types/constants, ` +
          `1 = support, 2 = engines, 3 = integrations, 4 = UI). ROOT_LEVEL_ALLOWED_FILES is ` +
          `derived from that map, so a single tier assignment covers both checks.`
      );
    }

    const staleEntries = [...ROOT_LEVEL_ALLOWED_FILES].filter((entry) => !rootLevelSourceFiles.includes(entry));
    if (staleEntries.length > 0) {
      throw new Error(
        `Stale entries in ROOT_LEVEL_TIER_MAP (file no longer exists — remove the entry):\n` +
          staleEntries.map((entry) => `  - ${entry}`).join('\n')
      );
    }
  });
});

describe('Import graph: vertical tier enforcement', () => {
  it('should not contain upward-tier imports beyond the ratchet allowlist', () => {
    const violations = collectViolations(({ relPath, topLevelDir, targetTopLevel }) => {
      const sourceTier = getSourceTier(relPath, topLevelDir);
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

// ---------------------------------------------------------------------------
// Tier documentation sync (A2 — prevents F-1 regression)
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(SRC_DIR, '..');

interface ParsedTierDoc {
  tiers: Map<string, number>;
  excluded: Set<string>;
}

/**
 * Parse the "Frontend tier model" section of a markdown / mdc file.
 *
 * Expected shape per tier bullet (whitespace tolerant; backticks and
 * trailing slashes are optional around directory names):
 *
 *   - **Tier N — <Group name>**: `dir1/`, `dir2/`, …
 *
 * Plus a trailing line describing the excluded set:
 *
 *   Excluded from tier analysis (not tiered): `dir1/`, `dir2/`, …
 *
 * Parsing stops at the next top-level heading after "Frontend tier model"
 * so we don't accidentally pull in the per-subsystem catalogue (which
 * mentions the same directories under different headings).
 */
function parseTierDoc(content: string, sourceLabel: string): ParsedTierDoc {
  // Anchor to the "Frontend tier model" heading and slice up to the next
  // heading of the same or shallower depth.
  const headingRe = /^(#{1,6})\s+Frontend tier model\s*$/m;
  const headingMatch = headingRe.exec(content);
  if (!headingMatch) {
    throw new Error(`Could not find "Frontend tier model" heading in ${sourceLabel}`);
  }
  const headingDepth = headingMatch[1]!.length;
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = content.slice(sectionStart);
  // Match the next heading at depth <= headingDepth
  const nextHeadingRe = new RegExp(`^#{1,${headingDepth}}\\s+\\S`, 'm');
  const nextHeadingMatch = nextHeadingRe.exec(rest);
  const section = nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;

  // Tier bullets: capture tier number + the rest of the line (the dir list).
  // Tolerant of em-dash (—), en-dash (–), or hyphen (-) between tier and group name.
  const tierBulletRe = /^[-*]\s+\*\*Tier\s+(\d+)\s+[—–-][^*]*\*\*\s*:\s*(.+)$/gm;
  const tiers = new Map<string, number>();
  let bulletMatch: RegExpExecArray | null;
  while ((bulletMatch = tierBulletRe.exec(section)) !== null) {
    const tier = Number(bulletMatch[1]);
    // Truncate at the first sentence terminator so trailing prose (which may
    // itself contain backtick-quoted tokens like `index.ts`) doesn't leak
    // into the dir list. systemPatterns.mdc puts a one-sentence description
    // after the dir list on the same line; AGENTS.md does not.
    // String.split() always returns >=1 element, so [0]! is safe.
    const dirList = bulletMatch[2]!.split(/\.\s/)[0]!;
    for (const dir of extractDirs(dirList)) {
      if (tiers.has(dir)) {
        throw new Error(`Directory \`${dir}\` listed under multiple tiers in ${sourceLabel}`);
      }
      tiers.set(dir, tier);
    }
  }

  if (tiers.size === 0) {
    throw new Error(`Parsed zero tier entries from ${sourceLabel} — parser regex may be stale.`);
  }

  // Excluded line: "Excluded from tier analysis ... :" followed by dir list,
  // up to the end of the sentence (terminating period that's not inside a
  // backtick run). Simpler: grab the rest of the line.
  const excluded = new Set<string>();
  const excludedRe = /Excluded from tier analysis[^:]*:\s*([^.\n]+)/;
  const excludedMatch = excludedRe.exec(section);
  if (excludedMatch) {
    for (const dir of extractDirs(excludedMatch[1]!)) {
      excluded.add(dir);
    }
  }

  return { tiers, excluded };
}

/**
 * Pull directory names out of a comma-separated list like:
 *   "`lib/`, `security/`, `styles/`. The canonical source ..."
 *
 * We:
 *  - look for backtick-quoted tokens first (the documented style),
 *  - strip trailing slashes,
 *  - ignore tokens that look like file paths (contain `/` after the trailing
 *    slash strip) — tier listings name top-level dirs only.
 */
function extractDirs(line: string): string[] {
  const dirs: string[] = [];
  const tokenRe = /`([^`]+)`/g;
  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = tokenRe.exec(line)) !== null) {
    let token = tokenMatch[1]!.trim();
    if (token.endsWith('/')) {
      token = token.slice(0, -1);
    }
    // Skip nested paths or non-directory tokens (e.g., file references).
    if (token.includes('/') || token.length === 0) {
      continue;
    }
    dirs.push(token);
  }
  return dirs;
}

function diffTierMaps(label: string, docTiers: Map<string, number>): string[] {
  const errors: string[] = [];
  for (const [dir, tier] of docTiers) {
    if (!(dir in TIER_MAP)) {
      errors.push(`${label}: \`${dir}\` is listed (tier ${tier}) but not in TIER_MAP`);
      continue;
    }
    if (TIER_MAP[dir] !== tier) {
      errors.push(`${label}: \`${dir}\` doc says tier ${tier}, TIER_MAP says tier ${TIER_MAP[dir]}`);
    }
  }
  for (const [dir, tier] of Object.entries(TIER_MAP)) {
    if (!docTiers.has(dir)) {
      errors.push(`${label}: \`${dir}\` is in TIER_MAP (tier ${tier}) but not listed in doc`);
    }
  }
  return errors;
}

function diffExcludedSets(label: string, docExcluded: Set<string>): string[] {
  const errors: string[] = [];
  for (const dir of docExcluded) {
    if (!EXCLUDED_TOP_LEVEL.has(dir)) {
      errors.push(`${label}: \`${dir}\` is listed as excluded but not in EXCLUDED_TOP_LEVEL`);
    }
  }
  for (const dir of EXCLUDED_TOP_LEVEL) {
    if (!docExcluded.has(dir)) {
      errors.push(`${label}: \`${dir}\` is in EXCLUDED_TOP_LEVEL but not listed as excluded in doc`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// ESLint / TIER_MAP sync
// ---------------------------------------------------------------------------
//
// eslint.config.mjs hand-mirrors TIER_MAP via const arrays for faster
// editor-time feedback. Two sources of truth drift; these tests text-parse
// the eslint config and assert it matches TIER_MAP.

const ESLINT_CONFIG_PATH = path.join(REPO_ROOT, 'eslint.config.mjs');

// Assumes flat string arrays — `[ 'a', 'b', ...OTHER ]`. Trailing `];` inside a
// comment or a nested bracket would derail the non-greedy match.
function parseConstantTokens(text: string, varName: string): string[] {
  const blockRe = new RegExp(`const\\s+${varName}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = blockRe.exec(text);
  if (!match) {
    throw new Error(`Could not find \`const ${varName} = [...]\` in eslint.config.mjs.`);
  }
  const body = match[1]!;
  const tokens: string[] = [];
  const tokenRe = /(['"])([^'"]+)\1|\.\.\.(\w+)/g;
  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = tokenRe.exec(body)) !== null) {
    if (tokenMatch[2] !== undefined) {
      tokens.push(tokenMatch[2]);
    } else if (tokenMatch[3] !== undefined) {
      tokens.push(`...${tokenMatch[3]}`);
    }
  }
  return tokens;
}

function expandTokens(name: string, defs: Map<string, string[]>, seen = new Set<string>()): string[] {
  if (seen.has(name)) {
    throw new Error(`Circular reference detected expanding ${name} in eslint.config.mjs.`);
  }
  const tokens = defs.get(name);
  if (!tokens) {
    throw new Error(`Unknown constant referenced: ${name}.`);
  }
  const nextSeen = new Set(seen).add(name);
  const expanded: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('...')) {
      expanded.push(...expandTokens(token.slice(3), defs, nextSeen));
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

function tierDirs(predicate: (tier: number) => boolean): string[] {
  return Object.entries(TIER_MAP)
    .filter(([, tier]) => predicate(tier))
    .map(([dir]) => dir);
}

function diffSets(label: string, expected: string[], actual: string[]): string[] {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const errors: string[] = [];
  for (const dir of expectedSet) {
    if (!actualSet.has(dir)) {
      errors.push(`${label}: TIER_MAP includes \`${dir}\` but eslint.config.mjs does not`);
    }
  }
  for (const dir of actualSet) {
    if (!expectedSet.has(dir)) {
      errors.push(`${label}: eslint.config.mjs includes \`${dir}\` but TIER_MAP does not`);
    }
  }
  return errors;
}

describe('ESLint config sync with TIER_MAP', () => {
  it('TIER_2_ENGINES, TIER_1_PLUS, TIER_2_PLUS, TIER_3_PLUS, TIER_4 mirror TIER_MAP', () => {
    const text = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    const names = ['TIER_2_ENGINES', 'TIER_1_PLUS', 'TIER_2_PLUS', 'TIER_3_PLUS', 'TIER_4'] as const;
    const defs = new Map<string, string[]>();
    for (const name of names) {
      defs.set(name, parseConstantTokens(text, name));
    }

    const expectations: Array<[string, string[]]> = [
      ['TIER_2_ENGINES', tierDirs((t) => t === 2)],
      ['TIER_1_PLUS', tierDirs((t) => t >= 1)],
      ['TIER_2_PLUS', tierDirs((t) => t >= 2)],
      ['TIER_3_PLUS', tierDirs((t) => t >= 3)],
      ['TIER_4', tierDirs((t) => t === 4)],
    ];

    const errors: string[] = [];
    for (const [name, expected] of expectations) {
      const actual = expandTokens(name, defs);
      errors.push(...diffSets(name, expected, actual));
    }

    if (errors.length > 0) {
      throw new Error(
        `eslint.config.mjs tier constants are out of sync with TIER_MAP ` +
          `(defined in src/validation/import-graph.ts):\n\n` +
          errors.map((e) => `  - ${e}`).join('\n') +
          `\n\nUpdate eslint.config.mjs to mirror TIER_MAP exactly, or update TIER_MAP if ` +
          `the architecture intentionally changed. The architecture ratchet is the source of ` +
          `truth; eslint provides faster editor-time feedback on the same boundaries.`
      );
    }
  });

  it('tierBoundaryConfig source-dir lists collectively cover every TIER_MAP directory', () => {
    const text = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // Capture the first argument array of each tierBoundaryConfig call.
    // The TIER_2_ENGINES.map(...) call has `[engine]` (an identifier, no
    // string literals), so it contributes nothing here — TIER_2_ENGINES
    // sync is verified separately.
    const callRe = /tierBoundaryConfig\(\s*\[([^\]]*)\]/g;
    const directDirs = new Set<string>();
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRe.exec(text)) !== null) {
      const body = callMatch[1]!;
      const stringRe = /['"]([^'"]+)['"]/g;
      let sm: RegExpExecArray | null;
      while ((sm = stringRe.exec(body)) !== null) {
        directDirs.add(sm[1]!);
      }
    }

    // What we expect those calls to cover, in total: every TIER_MAP dir
    // that isn't a Tier 2 engine (those are spread in via .map).
    const expectedDirect = tierDirs((t) => t !== 2);
    const errors = diffSets('tierBoundaryConfig source dirs', expectedDirect, [...directDirs]);

    if (errors.length > 0) {
      throw new Error(
        `eslint.config.mjs tierBoundaryConfig calls do not cover every TIER_MAP directory:\n\n` +
          errors.map((e) => `  - ${e}`).join('\n') +
          `\n\nEach directory in TIER_MAP must be the source of a tierBoundaryConfig call at ` +
          `its tier level (Tier 2 engines come from TIER_2_ENGINES.map). A missing entry means ` +
          `files in that directory get no ESLint tier enforcement.`
      );
    }
  });
});

describe('Tier documentation sync', () => {
  const docs: Array<[string, string]> = [
    ['AGENTS.md', path.join(REPO_ROOT, 'AGENTS.md')],
    ['.cursor/rules/systemPatterns.mdc', path.join(REPO_ROOT, '.cursor', 'rules', 'systemPatterns.mdc')],
  ];

  it.each(docs)('tier list in %s matches TIER_MAP', (label, filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseTierDoc(content, label);

    const errors = [...diffTierMaps(label, parsed.tiers), ...diffExcludedSets(label, parsed.excluded)];

    if (errors.length > 0) {
      throw new Error(
        `Tier documentation in ${label} is out of sync with TIER_MAP / EXCLUDED_TOP_LEVEL ` +
          `(both defined in src/validation/import-graph.ts):\n\n` +
          errors.map((e) => `  - ${e}`).join('\n') +
          `\n\nUpdate the doc's "Frontend tier model" bullet list to match the code, ` +
          `or update TIER_MAP if the architecture intentionally changed.`
      );
    }
  });

  // Locked-in regression coverage: feed the parser a hand-crafted doc with a
  // deliberately wrong tier and confirm the comparison logic flags it. Keeps
  // the assertion path exercised even when both real docs happen to agree.
  it('flags a divergent tier when doc and TIER_MAP disagree', () => {
    const fakeDoc = [
      '## Frontend tier model',
      '',
      '- **Tier 0 — Types & constants**: `types/`, `constants/`',
      '- **Tier 1 — Support**: `lib/`, `hooks/`', // hooks is actually Tier 2
      '',
      '## Next section',
    ].join('\n');

    const parsed = parseTierDoc(fakeDoc, 'fake.md');
    const errors = diffTierMaps('fake.md', parsed.tiers);
    expect(errors.some((e) => e.includes('`hooks`') && e.includes('tier 1') && e.includes('tier 2'))).toBe(true);
  });

  it('flags a directory listed in the doc but missing from TIER_MAP', () => {
    const fakeDoc = [
      '## Frontend tier model',
      '',
      '- **Tier 1 — Support**: `lib/`, `phantom-module/`',
      '',
      '## Next section',
    ].join('\n');

    const parsed = parseTierDoc(fakeDoc, 'fake.md');
    const errors = diffTierMaps('fake.md', parsed.tiers);
    expect(errors.some((e) => e.includes('`phantom-module`') && e.includes('not in TIER_MAP'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TS path-alias tripwire
// ---------------------------------------------------------------------------
//
// The import-graph scanner only resolves relative specifiers. If
// tsconfig.compilerOptions.paths is ever populated — or if baseUrl is
// widened beyond the scaffolded baseline — aliased / bare-rooted imports
// would silently bypass tier enforcement. Fail loudly the moment either
// appears so whoever introduces it extends the scanner first.
//
// KNOWN_BASELINE_BASE_URL documents the pre-existing blind spot: the
// scaffolded `.config/tsconfig.json` sets baseUrl="../src", which lets
// bare specifiers like `import x from 'lib/foo'` resolve against src/.
// These are already invisible to extractRelativeImports. Treating the
// baseline as known (rather than failing now) keeps the tripwire shippable
// while still catching any further widening.

const KNOWN_BASELINE_BASE_URL: Record<string, string> = {
  '.config/tsconfig.json': '../src',
};

describe('TS path-alias tripwire', () => {
  const tsconfigs = [path.join(REPO_ROOT, 'tsconfig.json'), path.join(REPO_ROOT, '.config', 'tsconfig.json')];

  it.each(tsconfigs)('%s declares no compilerOptions.paths or new baseUrl', (tsconfigPath) => {
    const text = fs.readFileSync(tsconfigPath, 'utf-8');
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, unknown>; baseUrl?: string };
    };
    const relPath = toPosixPath(path.relative(REPO_ROOT, tsconfigPath));
    const paths = parsed.compilerOptions?.paths ?? {};
    const baseUrl = parsed.compilerOptions?.baseUrl;

    if (Object.keys(paths).length > 0) {
      throw new Error(
        `${relPath} declares compilerOptions.paths, but the ` +
          `import-graph scanner in src/validation/import-graph.ts only resolves relative ` +
          `specifiers. Aliased imports would silently bypass tier enforcement. Extend the ` +
          `scanner to resolve tsconfig.paths before merging this change.`
      );
    }

    if (baseUrl !== undefined && baseUrl !== KNOWN_BASELINE_BASE_URL[relPath]) {
      const baseline = KNOWN_BASELINE_BASE_URL[relPath];
      const baselineNote = baseline
        ? `Known baseline for ${relPath} is "${baseline}"; this file declares "${baseUrl}".`
        : `No baseline is registered for ${relPath}.`;
      throw new Error(
        `${relPath} declares compilerOptions.baseUrl="${baseUrl}", which lets bare specifiers ` +
          `like \`import x from 'lib/foo'\` resolve against the baseUrl root. The import-graph ` +
          `scanner in src/validation/import-graph.ts only resolves relative specifiers, so these ` +
          `imports would silently bypass tier enforcement. ${baselineNote} Either extend the ` +
          `scanner to resolve baseUrl-rooted specifiers, or update KNOWN_BASELINE_BASE_URL in ` +
          `architecture.test.ts if this change is deliberate.`
      );
    }
  });
});
