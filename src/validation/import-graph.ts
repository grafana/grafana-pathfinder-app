/**
 * Import Graph Infrastructure
 *
 * Utilities for analyzing the import graph of the codebase. Used by
 * architecture.test.ts for boundary enforcement and available for
 * future tooling (dependency visualizers, lint plugins, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export const SRC_DIR = path.resolve(__dirname, '..');

/**
 * Tier model: lower number = more foundational.
 * A file in tier N may import from tier N or any tier < N.
 * Importing from tier > N is a violation.
 */
export const TIER_MAP: Record<string, number> = {
  types: 0,
  constants: 0,
  lib: 1,
  security: 1,
  styles: 1,
  'global-state': 1,
  utils: 1,
  validation: 1,
  recovery: 1,
  'context-engine': 2,
  'docs-retrieval': 2,
  'interactive-engine': 2,
  'requirements-manager': 2,
  'learning-paths': 2,
  'package-engine': 2,
  hooks: 2,
  integrations: 3,
  components: 4,
  pages: 4,
};

export const TIER_2_ENGINES = Object.entries(TIER_MAP)
  .filter(([, tier]) => tier === 2)
  .map(([dir]) => dir);

export const EXCLUDED_TOP_LEVEL = new Set(['test-utils', 'cli', 'bundled-interactives', 'img', 'locales']);

/**
 * Root-level src/ files with their assigned tiers.
 *
 * Files in src root have `topLevelDir === null` and would otherwise bypass
 * tier enforcement. Assigning each an explicit tier closes that gap (F-6).
 * Every entry must also appear in ROOT_LEVEL_ALLOWED_FILES — the sync is
 * locked by a unit test in import-graph.test.ts.
 *
 * Tier assignments here follow the same semantics as TIER_MAP: a file may
 * import from its own tier or lower. `module.tsx` is the plugin entrypoint
 * and legitimately reaches into pages/integrations (Tier 3/4), so it gets
 * Tier 4. `constants.ts` is pure data and lives at Tier 0.
 */
export const ROOT_LEVEL_TIER_MAP: Record<string, number> = {
  'constants.ts': 0,
  'constants.test.ts': 0,
  'module.tsx': 4,
};

export const ROOT_LEVEL_ALLOWED_FILES = new Set(Object.keys(ROOT_LEVEL_TIER_MAP));

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function isTestFile(filePath: string): boolean {
  const relative = path.relative(SRC_DIR, filePath);
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(relative) ||
    relative.startsWith(`test-utils${path.sep}`) ||
    relative.includes(`${path.sep}__tests__${path.sep}`)
  );
}

export function collectSourceFiles(): string[] {
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

export function getRootLevelSourceFiles(): string[] {
  return fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => entry.name);
}

export interface FileImports {
  file: string;
  relPath: string;
  topLevelDir: string | null;
  /** Raw relative specifiers (e.g. "./foo", "../lib/bar"). Resolve with resolveImportToRelative(). */
  imports: string[];
  /**
   * Bare/aliased specifiers (e.g. "@components/foo") already resolved to
   * src-relative paths via tsconfig.paths. Empty when no aliases are
   * configured. Downstream callers treat these identically to resolved
   * relative imports.
   */
  resolvedAliasImports: string[];
}

/**
 * Returns the top-level directory for a path relative to SRC_DIR.
 * Files directly in SRC_DIR (single segment, e.g. "module.ts") return null
 * and are intentionally excluded from tier enforcement.
 */
export function getTopLevelDir(relPath: string): string | null {
  const segments = toPosixPath(relPath).split('/');
  if (segments.length <= 1) {
    return null;
  }
  // ?? null satisfies noUncheckedIndexedAccess; split() always returns at least one element
  return segments[0] ?? null;
}

const isRelativeSpecifier = (value: string): boolean => value.startsWith('./') || value.startsWith('../');

function extractImportSpecifiers(content: string, filter: (specifier: string) => boolean): string[] {
  const specifiers = new Set<string>();
  const sourceFile = ts.createSourceFile(
    'import-graph-input.tsx',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const addIfMatch = (value: string): void => {
    if (filter(value)) {
      specifiers.add(value);
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addIfMatch(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node)) {
      const [firstArg] = node.arguments;
      if (!firstArg || !ts.isStringLiteralLike(firstArg)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addIfMatch(firstArg.text);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addIfMatch(firstArg.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...specifiers];
}

export function extractRelativeImports(content: string): string[] {
  return extractImportSpecifiers(content, isRelativeSpecifier);
}

export function extractBareImports(content: string): string[] {
  return extractImportSpecifiers(content, (s) => !isRelativeSpecifier(s));
}

export function resolveImportToRelative(fileDir: string, importPath: string): string | null {
  const resolved = path.resolve(fileDir, importPath);
  const relative = path.relative(SRC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixPath(relative);
}

export function getTargetTopLevel(resolvedRelative: string): string | null {
  const segments = toPosixPath(resolvedRelative).split('/');
  // ?? null satisfies noUncheckedIndexedAccess; split() always returns at least one element
  return segments[0] ?? null;
}

/**
 * Returns the tier number for an import-graph source file.
 *
 * For files inside a top-level directory, looks up TIER_MAP[topLevelDir].
 * For root-level files (topLevelDir === null), looks up ROOT_LEVEL_TIER_MAP
 * by the file's basename (e.g. "module.tsx"). Returns undefined when no
 * tier is assigned — callers should treat that as "skip this file".
 */
export function getSourceTier(relPath: string, topLevelDir: string | null): number | undefined {
  if (topLevelDir !== null) {
    return TIER_MAP[topLevelDir];
  }
  const basename = toPosixPath(relPath);
  return ROOT_LEVEL_TIER_MAP[basename];
}

let cachedFileImports: FileImports[] | undefined;

export function getAllFileImports(): FileImports[] {
  if (cachedFileImports) {
    return cachedFileImports;
  }
  const aliasConfig = loadAliasConfig();
  const files = collectSourceFiles();
  cachedFileImports = files.map((file) => {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    const topLevelDir = getTopLevelDir(relPath);
    const content = fs.readFileSync(file, 'utf-8');
    const imports = extractRelativeImports(content);
    const resolvedAliasImports = aliasConfig
      ? extractBareImports(content)
          .map((spec) => resolveAliasedSpecifierWithConfig(spec, aliasConfig))
          .filter((v): v is string => v !== null)
      : [];
    return { file, relPath, topLevelDir, imports, resolvedAliasImports };
  });
  return cachedFileImports;
}

/** Reset the cached file imports. Useful for testing. */
export function resetCache(): void {
  cachedFileImports = undefined;
  aliasConfigCache = undefined;
}

// ---------------------------------------------------------------------------
// TypeScript path-alias resolution (B6 — closes F-7)
// ---------------------------------------------------------------------------
//
// The repo's tsconfig has baseUrl set but no `paths` today. If aliases are
// later added (e.g. `@/components/*` → `components/*`), the relative-only
// scanner above would silently miss those edges. This block reads
// tsconfig.compilerOptions.paths and resolves alias specifiers to src-
// relative paths, the same format the relative resolver produces, so
// downstream callers (collectViolations) treat both edge sources
// identically.

interface AliasReplacement {
  prefix: string;
  suffix: string;
}

interface AliasPattern {
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  replacements: AliasReplacement[];
}

export interface AliasConfig {
  baseDir: string;
  patterns: AliasPattern[];
}

const TSCONFIG_PATH = path.resolve(SRC_DIR, '..', '.config', 'tsconfig.json');

let aliasConfigCache: { value: AliasConfig | null } | undefined;

/**
 * Strip C-style and line comments from JSONC content so JSON.parse can
 * read it. Naive but sufficient for tsconfig files, which don't use
 * comment-like sequences inside string literals.
 */
function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function loadAliasConfig(tsconfigPath: string = TSCONFIG_PATH): AliasConfig | null {
  if (aliasConfigCache) {
    return aliasConfigCache.value;
  }
  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, 'utf-8')));
  } catch (err) {
    aliasConfigCache = { value: null };
    return null;
  }
  const co = parsed.compilerOptions ?? {};
  const paths = co.paths;
  if (!paths || Object.keys(paths).length === 0) {
    aliasConfigCache = { value: null };
    return null;
  }
  const baseUrl = co.baseUrl ?? '.';
  const baseDir = path.resolve(path.dirname(tsconfigPath), baseUrl);
  const patterns: AliasPattern[] = Object.entries(paths).map(([pattern, replacements]) => {
    const hasWildcard = pattern.includes('*');
    const [prefix, suffix = ''] = pattern.split('*');
    return {
      prefix: prefix ?? '',
      suffix,
      hasWildcard,
      replacements: replacements.map((r) => {
        const [rPrefix, rSuffix = ''] = r.split('*');
        return { prefix: rPrefix ?? '', suffix: rSuffix };
      }),
    };
  });
  const config: AliasConfig = { baseDir, patterns };
  aliasConfigCache = { value: config };
  return config;
}

/**
 * Resolve a bare module specifier against an alias config. Returns a
 * src-relative path (POSIX separators) if the specifier matches an
 * alias pattern AND the resolution lands inside SRC_DIR. Returns null
 * otherwise — including when the specifier matches but resolves to a
 * node_modules path (e.g. `@grafana/data`) or escapes SRC_DIR.
 *
 * Pure function suitable for unit tests with synthetic configs.
 */
export function resolveAliasedSpecifierWithConfig(specifier: string, config: AliasConfig): string | null {
  for (const pat of config.patterns) {
    if (pat.hasWildcard) {
      if (!specifier.startsWith(pat.prefix) || !specifier.endsWith(pat.suffix)) {
        continue;
      }
      if (specifier.length <= pat.prefix.length + pat.suffix.length) {
        continue;
      }
      const wildcardValue = specifier.slice(pat.prefix.length, specifier.length - pat.suffix.length);
      for (const replacement of pat.replacements) {
        const resolvedRelative = replacement.prefix + wildcardValue + replacement.suffix;
        const srcRelative = resolveInsideSrcDir(config.baseDir, resolvedRelative);
        if (srcRelative !== null) {
          return srcRelative;
        }
      }
      return null;
    }

    if (specifier === pat.prefix) {
      for (const replacement of pat.replacements) {
        const srcRelative = resolveInsideSrcDir(config.baseDir, replacement.prefix);
        if (srcRelative !== null) {
          return srcRelative;
        }
      }
      return null;
    }
  }
  return null;
}

function resolveInsideSrcDir(baseDir: string, relativeFromBase: string): string | null {
  const absolute = path.resolve(baseDir, relativeFromBase);
  const srcRelative = path.relative(SRC_DIR, absolute);
  if (srcRelative.startsWith('..') || path.isAbsolute(srcRelative)) {
    return null;
  }
  return toPosixPath(srcRelative);
}

// ---------------------------------------------------------------------------
// Ratchet mechanism
// ---------------------------------------------------------------------------

export function getNewViolations(violations: Set<string>, allowlist: Set<string>): string[] {
  return [...violations].filter((violation) => !allowlist.has(violation));
}

export function getStaleEntries(violations: Set<string>, allowlist: Set<string>): string[] {
  return [...allowlist].filter((entry) => !violations.has(entry));
}

/**
 * Asserts that the detected violations exactly match the allowlist.
 * Throws with an agent-oriented error message if:
 * - New violations are found that aren't in the allowlist
 * - Stale entries exist in the allowlist that no longer correspond to violations
 */
export function assertRatchet(
  violations: Set<string>,
  allowlist: Set<string>,
  label: string,
  allowlistConstant: string,
  newViolationAdvice: string
): void {
  const newViolations = getNewViolations(violations, allowlist);
  if (newViolations.length > 0) {
    throw new Error(
      `New ${label} detected:\n${newViolations.map((v) => `  - ${v}`).join('\n')}\n\n${newViolationAdvice}`
    );
  }

  const staleEntries = getStaleEntries(violations, allowlist);
  if (staleEntries.length > 0) {
    throw new Error(
      `Stale entries in ${allowlistConstant} (${label} allowlist — violation was fixed, remove the entry):\n` +
        staleEntries.map((e) => `  - ${e}`).join('\n')
    );
  }
}
