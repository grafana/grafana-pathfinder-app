/**
 * Import Graph Infrastructure
 *
 * Utilities for analyzing the import graph of the codebase. Used by
 * architecture.test.ts for boundary enforcement and available for
 * future tooling (dependency visualizers, lint plugins, etc.).
 */

import * as fs from 'fs';
import { builtinModules } from 'module';
import * as path from 'path';
import * as ts from 'typescript';

export const SRC_DIR = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(SRC_DIR, '..');

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
  'snippet-engine': 2,
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
 * Root-level src/ files have `topLevelDir === null` and would otherwise
 * bypass tier enforcement. Each entry gets an explicit tier so the vertical
 * check can resolve a source tier for them. `module.tsx` is the plugin
 * entrypoint and legitimately reaches into pages/integrations, so Tier 4.
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
  imports: string[];
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

export interface TsconfigPathsConfig {
  configDir: string;
  paths: Record<string, string[]>;
}

export function readJsoncFile<T>(filePath: string): T {
  const text = fs.readFileSync(filePath, 'utf-8');
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped) as T;
}

export function loadTsconfigPaths(tsconfigPath: string): TsconfigPathsConfig {
  const parsed = readJsoncFile<{ compilerOptions?: { paths?: Record<string, string[]> } }>(tsconfigPath);
  return {
    configDir: path.dirname(tsconfigPath),
    paths: parsed.compilerOptions?.paths ?? {},
  };
}

/** TS `paths` patterns support at most one `*`; mirrors that instead of full glob matching. */
function matchPathPattern(specifier: string, pattern: string): string | null {
  const starIndex = pattern.indexOf('*');
  if (starIndex === -1) {
    return specifier === pattern ? '' : null;
  }
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix) ||
    specifier.length < prefix.length + suffix.length
  ) {
    return null;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

const ALIAS_RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function findExistingSourceFile(candidateNoExt: string): string | null {
  for (const suffix of ALIAS_RESOLUTION_SUFFIXES) {
    const candidate = candidateNoExt + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves a bare specifier through tsconfig `paths` the same way TypeScript
 * would, but only reports a hit when the target exists on disk — a pattern
 * like `"*"` matches any string, so an npm package name (`react`) would
 * otherwise "match" and get misresolved as an internal file. Returns the
 * real file path (with extension), unlike relative specifiers elsewhere in
 * this module which are extension-less — callers that need the relative-
 * specifier convention should strip it themselves.
 */
export function resolvePathAlias(specifier: string, tsconfigPaths: TsconfigPathsConfig): string | null {
  for (const [pattern, targets] of Object.entries(tsconfigPaths.paths)) {
    const matched = matchPathPattern(specifier, pattern);
    if (matched === null) {
      continue;
    }
    for (const target of targets) {
      const substituted = target.includes('*') ? target.replace('*', matched) : target;
      const absolute = path.resolve(tsconfigPaths.configDir, substituted);
      const found = findExistingSourceFile(absolute);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export interface AliasResolutionContext {
  fileDir: string;
  tsconfigPaths: TsconfigPathsConfig;
}

export interface ImportRecord {
  /** Specifier as written; alias-resolved internal imports are rewritten to a relative specifier. */
  specifier: string;
  /** True when every occurrence is erased at compile time (`import type` / all-type-only specifiers). */
  typeOnly: boolean;
  /** True when every occurrence is a lazy `import()` expression (never evaluated at module load). */
  dynamic: boolean;
  /** True for relative specifiers and alias-resolved internal files; false for external packages. */
  relative: boolean;
}

function isTypeOnlyImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return false;
  }
  const elements = clause.namedBindings.elements;
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

function isTypeOnlyExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) {
    return true;
  }
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return false;
  }
  const elements = node.exportClause.elements;
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

/**
 * Parses every import/export/require/dynamic-import specifier in a module.
 * Occurrences of the same specifier are merged: the record is typeOnly or
 * dynamic only when ALL occurrences are (a single value import makes the
 * whole edge a value edge — that is what module evaluation sees).
 */
export function extractImportRecords(content: string, aliasContext?: AliasResolutionContext): ImportRecord[] {
  const records = new Map<string, ImportRecord>();
  const sourceFile = ts.createSourceFile(
    'import-graph-input.tsx',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const isRelativeSpecifier = (value: string): boolean => value.startsWith('./') || value.startsWith('../');
  const addSpecifier = (value: string, typeOnly: boolean, dynamic: boolean): void => {
    let specifier = value;
    let relative = isRelativeSpecifier(value);
    if (!relative && aliasContext) {
      const resolved = resolvePathAlias(value, aliasContext.tsconfigPaths);
      if (resolved) {
        const withoutExt = resolved.replace(/\/index\.tsx?$/, '').replace(/\.tsx?$/, '');
        const rel = toPosixPath(path.relative(aliasContext.fileDir, withoutExt));
        specifier = rel.startsWith('.') ? rel : `./${rel}`;
        relative = true;
      }
    }
    const existing = records.get(specifier);
    if (existing) {
      // dynamic reflects value occurrences only — a type-only occurrence
      // neither makes the edge eager nor lazy
      if (!typeOnly) {
        existing.dynamic = existing.typeOnly ? dynamic : existing.dynamic && dynamic;
      }
      existing.typeOnly = existing.typeOnly && typeOnly;
    } else {
      records.set(specifier, { specifier, typeOnly, dynamic, relative });
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? isTypeOnlyImportDeclaration(node)
        : isTypeOnlyExportDeclaration(node);
      addSpecifier(node.moduleSpecifier.text, typeOnly, false);
    }

    if (ts.isCallExpression(node)) {
      const [firstArg] = node.arguments;
      if (!firstArg || !ts.isStringLiteralLike(firstArg)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addSpecifier(firstArg.text, false, false);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(firstArg.text, false, true);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...records.values()];
}

export function extractRelativeImports(content: string, aliasContext?: AliasResolutionContext): string[] {
  return extractImportRecords(content, aliasContext)
    .filter((record) => record.relative)
    .map((record) => record.specifier);
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

export function getSourceTier(relPath: string, topLevelDir: string | null): number | undefined {
  if (topLevelDir !== null) {
    return TIER_MAP[topLevelDir];
  }
  return ROOT_LEVEL_TIER_MAP[toPosixPath(relPath)];
}

let cachedFileImports: FileImports[] | undefined;
let cachedTsconfigPaths: TsconfigPathsConfig | undefined;

function getProjectTsconfigPaths(): TsconfigPathsConfig {
  if (!cachedTsconfigPaths) {
    cachedTsconfigPaths = loadTsconfigPaths(path.join(REPO_ROOT, '.config', 'tsconfig.json'));
  }
  return cachedTsconfigPaths;
}

export function getAllFileImports(): FileImports[] {
  if (cachedFileImports) {
    return cachedFileImports;
  }
  const tsconfigPaths = getProjectTsconfigPaths();
  const files = collectSourceFiles();
  cachedFileImports = files.map((file) => {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    const topLevelDir = getTopLevelDir(relPath);
    const content = fs.readFileSync(file, 'utf-8');
    const fileDir = path.dirname(file);
    const imports = extractRelativeImports(content, { fileDir, tsconfigPaths });
    return { file, relPath, topLevelDir, imports };
  });
  return cachedFileImports;
}

/** Reset the cached file imports and tsconfig paths. Useful for testing. */
export function resetCache(): void {
  cachedFileImports = undefined;
  cachedTsconfigPaths = undefined;
}

// ---------------------------------------------------------------------------
// Module graph & cycle detection
// ---------------------------------------------------------------------------

/**
 * Resolves an import specifier to the src-relative path of the real file it
 * points at (with extension), or null if it resolves outside src/ or to no
 * file on disk. Unlike resolveImportToRelative (which returns an extension-
 * less path and never touches the filesystem), this collapses `./foo`,
 * `./foo.ts`, and `./foo/index.ts` onto the same canonical node key so the
 * graph has one node per module.
 */
export function resolveImportToFileNode(fileDir: string, importPath: string): string | null {
  const absoluteNoExt = path.resolve(fileDir, importPath);
  const found = findExistingSourceFile(absoluteNoExt);
  if (!found) {
    return null;
  }
  const relative = path.relative(SRC_DIR, found);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixPath(relative);
}

export interface ModuleGraph {
  /** src-relative posix paths of every non-test source file (with extension). */
  nodes: string[];
  /** node -> set of nodes it imports (intra-src, non-test edges only). */
  adjacency: Map<string, Set<string>>;
}

/**
 * Builds the file-level import graph over production source (test files are
 * excluded as both nodes and edge targets). Self-edges are dropped. Edges to
 * unresolvable / external / test targets are dropped.
 */
export function buildModuleGraph(): ModuleGraph {
  const all = getAllFileImports();
  const adjacency = new Map<string, Set<string>>();

  for (const { file, relPath, imports } of all) {
    if (isTestFile(file)) {
      continue;
    }
    let edges = adjacency.get(relPath);
    if (!edges) {
      edges = new Set<string>();
      adjacency.set(relPath, edges);
    }
    const fileDir = path.dirname(file);
    for (const imp of imports) {
      const target = resolveImportToFileNode(fileDir, imp);
      if (!target || target === relPath || isTestFile(path.join(SRC_DIR, target))) {
        continue;
      }
      edges.add(target);
    }
  }

  // Close the graph over production source: drop edges into excluded dirs
  // (cli/, bundled-interactives/, …) which are never iterated as nodes and so
  // are always acyclic sinks anyway. Keeps every edge target a real node.
  const nodes = new Set(adjacency.keys());
  for (const edges of adjacency.values()) {
    for (const target of edges) {
      if (!nodes.has(target)) {
        edges.delete(target);
      }
    }
  }

  return { nodes: [...nodes], adjacency };
}

/**
 * Tarjan's strongly-connected-components algorithm. Every returned component
 * of size >= 2 is a set of files that mutually reach each other — i.e. a
 * circular-dependency cluster. Size-1 components are acyclic singletons (self
 * edges are already excluded by buildModuleGraph), so callers filter to
 * length >= 2 to get the cycles.
 *
 * Iterative (explicit work stack) so a deep chain in a ~600-node graph can't
 * overflow the JS call stack.
 */
export function findStronglyConnectedComponents(graph: ModuleGraph): string[][] {
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const sccStack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  interface Frame {
    node: string;
    neighbors: string[];
    next: number;
  }

  for (const start of graph.nodes) {
    if (indices.has(start)) {
      continue;
    }
    const work: Frame[] = [{ node: start, neighbors: [...(graph.adjacency.get(start) ?? [])], next: 0 }];
    indices.set(start, counter);
    lowlink.set(start, counter);
    counter++;
    sccStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.next < frame.neighbors.length) {
        const w = frame.neighbors[frame.next]!;
        frame.next++;
        if (!indices.has(w)) {
          indices.set(w, counter);
          lowlink.set(w, counter);
          counter++;
          sccStack.push(w);
          onStack.add(w);
          work.push({ node: w, neighbors: [...(graph.adjacency.get(w) ?? [])], next: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, indices.get(w)!));
        }
      } else {
        if (lowlink.get(frame.node) === indices.get(frame.node)) {
          const component: string[] = [];
          let w: string;
          do {
            w = sccStack.pop()!;
            onStack.delete(w);
            component.push(w);
          } while (w !== frame.node);
          result.push(component);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
        }
      }
    }
  }

  return result;
}

/** SCCs of size >= 2 — the circular-dependency clusters, each members sorted. */
export function findCycles(graph: ModuleGraph = buildModuleGraph()): string[][] {
  return findStronglyConnectedComponents(graph)
    .filter((component) => component.length >= 2)
    .map((component) => [...component].sort());
}

/**
 * A grandfathered cycle in the ratchet allowlist. Beyond the SCC key, each
 * carries a justification and a paydown tracking issue so a new cycle can't be
 * silenced by pasting its key in with an empty rubber-stamp comment.
 */
export interface AllowedCycleEntry {
  cycle: string;
  reason: string;
  tracking: string;
}

const CYCLE_REASON_MIN_LENGTH = 20;
const CYCLE_TRACKING_RE = /^#\d+$/;
const CYCLE_TRACKING_URL_RE = /github\.com\/[^/]+\/[^/]+\/issues\/\d+/;

/**
 * Validates that every allowlisted cycle is justified and tracked: unique key,
 * a substantive `reason`, and a `tracking` issue (either `#1234` or a GitHub
 * issues URL). Returns a list of human-readable errors (empty when all pass).
 */
export function validateAllowedCycleEntries(entries: readonly AllowedCycleEntry[]): string[] {
  const errors: string[] = [];

  const keys = new Set(entries.map((entry) => entry.cycle));
  if (keys.size !== entries.length) {
    errors.push(`Duplicate 'cycle' keys in ALLOWED_CYCLES (${entries.length} entries, ${keys.size} unique).`);
  }

  for (const entry of entries) {
    const label = entry.cycle.split(' <-> ')[0] || '(empty cycle key)';
    if (entry.reason.trim().length < CYCLE_REASON_MIN_LENGTH) {
      errors.push(`${label}: 'reason' is missing or too short — explain why the cycle is tolerated.`);
    }
    if (!CYCLE_TRACKING_RE.test(entry.tracking) && !CYCLE_TRACKING_URL_RE.test(entry.tracking)) {
      errors.push(
        `${label}: 'tracking' must be an issue reference ('#1234') or a GitHub issues URL, got '${entry.tracking}'.`
      );
    }
  }

  return errors;
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

// ---------------------------------------------------------------------------
// Environment reachability (Node contexts)
// ---------------------------------------------------------------------------
//
// The tier model constrains which of OUR directories may import which — but
// it cannot see that an external package requires a browser. src/cli/ and
// tests/ execute in plain Node (the pathfinder CLI, and Playwright test
// discovery for both the main suite and the e2e-runner), so everything they
// transitively reach at module-eval time must load without browser globals.
// This scan walks the value-import closure from those roots and checks every
// external package against a Node-safe allowlist maintained in
// architecture.test.ts.

/** Repo-relative directories (or files) whose contents execute in plain Node. */
export const NODE_CONTEXT_ROOTS = ['src/cli', 'tests', 'playwright.config.ts'];

/**
 * Jest-managed test files (jsdom environment by default) are excluded from
 * the Node-context roots: they get emulated browser globals and jest.mock
 * protection, so they are not evidence of plain-Node execution. The effective
 * testMatch is the root jest.config.js — src/ patterns from the scaffolded
 * .config/jest.config.js plus tests/e2e-runner/utils/**\/*.test.*. Playwright
 * loads only *.spec.ts files (see playwright.config.ts testMatch), which jest
 * never matches outside src/.
 */
export function isJestManagedTestFile(absPath: string): boolean {
  const rel = toPosixPath(path.relative(REPO_ROOT, absPath));
  if (rel.startsWith('src/')) {
    return /\.(test|spec|jest)\.(ts|tsx)$/.test(rel) || rel.includes('/__tests__/');
  }
  if (rel.startsWith('tests/e2e-runner/utils/')) {
    return /\.test\.(ts|tsx)$/.test(rel);
  }
  return false;
}

export function collectNodeContextFiles(roots: readonly string[] = NODE_CONTEXT_ROOTS): string[] {
  const files: string[] = [];
  const addFile = (fullPath: string) => {
    if (/\.(ts|tsx)$/.test(fullPath) && !fullPath.endsWith('.d.ts') && !isJestManagedTestFile(fullPath)) {
      files.push(fullPath);
    }
  };
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        addFile(fullPath);
      }
    }
  }
  for (const root of roots) {
    // resolve (not join) so tests can pass absolute fixture directories
    const absRoot = path.resolve(REPO_ROOT, root);
    if (!fs.existsSync(absRoot)) {
      continue;
    }
    if (fs.statSync(absRoot).isDirectory()) {
      walk(absRoot);
    } else {
      addFile(absRoot);
    }
  }
  return files;
}

/** `@scope/name/deep/path` -> `@scope/name`; `pkg/deep` -> `pkg`; strips a `node:` prefix. */
export function packageNameOf(specifier: string): string {
  const spec = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  const segments = spec.split('/');
  return (spec.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]) || spec;
}

const NODE_BUILTIN_MODULES = new Set(builtinModules);

export function isNodeBuiltin(specifier: string): boolean {
  // prefix-only builtins (node:test, node:sqlite) appear in builtinModules
  // WITH the prefix, so check both spellings
  const name = packageNameOf(specifier);
  return NODE_BUILTIN_MODULES.has(name) || NODE_BUILTIN_MODULES.has(`node:${name}`);
}

/**
 * Relative imports that only a bundler can load — importing one from
 * Node-executed code crashes at module evaluation.
 */
const BUNDLER_ONLY_ASSET_RE = /\.(css|scss|sass|less|svg|png|jpe?g|gif|woff2?)$/;

export interface EnvReachabilityViolation {
  /** Repo-relative posix path of the importing file. */
  file: string;
  /** The offending import specifier as written. */
  specifier: string;
  /** Witness chain from a Node entrypoint to `file` (repo-relative posix paths). */
  chain: string[];
}

export interface EnvReachabilityScan {
  violations: EnvReachabilityViolation[];
  /** Non-builtin external packages reachable via value imports (for stale-entry checks). */
  reachedExternalPackages: Set<string>;
  reachableFileCount: number;
}

/**
 * BFS over value imports (type-only edges are erased at compile time and
 * skipped; dynamic `import()` edges ARE followed — the CLI lazy-loads its
 * commands, so lazy modules still execute in Node eventually). Every external
 * package encountered must be in `nodeSafeExternals` or be a Node builtin;
 * bundler-only asset imports (css/svg/…) are always violations.
 */
export function scanNodeEnvReachability(
  nodeSafeExternals: ReadonlySet<string>,
  rootDirs: readonly string[] = NODE_CONTEXT_ROOTS
): EnvReachabilityScan {
  const tsconfigPaths = loadTsconfigPaths(path.join(REPO_ROOT, '.config', 'tsconfig.json'));
  const roots = collectNodeContextFiles(rootDirs);

  const parents = new Map<string, string | null>();
  const queue: Array<{ file: string; via: string | null }> = roots.map((file) => ({ file, via: null }));
  const violations: EnvReachabilityViolation[] = [];
  const reachedExternalPackages = new Set<string>();

  const relPath = (absPath: string) => toPosixPath(path.relative(REPO_ROOT, absPath));
  const chainOf = (absPath: string): string[] => {
    const chain: string[] = [];
    let current: string | null = absPath;
    while (current) {
      chain.unshift(relPath(current));
      current = parents.get(current) ?? null;
    }
    return chain;
  };

  while (queue.length > 0) {
    const { file, via } = queue.shift()!;
    if (parents.has(file)) {
      continue;
    }
    parents.set(file, via);

    const content = fs.readFileSync(file, 'utf-8');
    const fileDir = path.dirname(file);
    const records = extractImportRecords(content, { fileDir, tsconfigPaths });

    for (const record of records) {
      if (record.typeOnly) {
        continue;
      }
      if (record.relative) {
        if (BUNDLER_ONLY_ASSET_RE.test(record.specifier)) {
          violations.push({ file: relPath(file), specifier: record.specifier, chain: chainOf(file) });
          continue;
        }
        // ESM-style extensioned specifiers ('./helper.js') point at emitted
        // output; map back to the TS source when no literal file matches.
        const literal = findExistingSourceFile(path.resolve(fileDir, record.specifier));
        const stripped = record.specifier.replace(/\.(mjs|cjs|jsx?)$/, '');
        const resolved =
          literal ?? (stripped !== record.specifier ? findExistingSourceFile(path.resolve(fileDir, stripped)) : null);
        if (resolved && /\.(tsx?|jsx?)$/.test(resolved)) {
          if (!parents.has(resolved)) {
            queue.push({ file: resolved, via: file });
          }
        } else if (!resolved || !resolved.endsWith('.json')) {
          // Unresolvable relative value imports and non-JSON/non-source
          // targets (.md, .html, …) would crash plain Node — and silently
          // dropping the edge would prune the whole subtree from the scan.
          violations.push({ file: relPath(file), specifier: record.specifier, chain: chainOf(file) });
        }
        continue;
      }
      if (isNodeBuiltin(record.specifier)) {
        continue;
      }
      const pkg = packageNameOf(record.specifier);
      reachedExternalPackages.add(pkg);
      if (!nodeSafeExternals.has(pkg)) {
        violations.push({ file: relPath(file), specifier: record.specifier, chain: chainOf(file) });
      }
    }
  }

  return { violations, reachedExternalPackages, reachableFileCount: parents.size };
}
