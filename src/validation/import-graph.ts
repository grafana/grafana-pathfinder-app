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

export function extractRelativeImports(content: string, aliasContext?: AliasResolutionContext): string[] {
  const specifiers = new Set<string>();
  const sourceFile = ts.createSourceFile(
    'import-graph-input.tsx',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const isRelativeSpecifier = (value: string): boolean => value.startsWith('./') || value.startsWith('../');
  const addSpecifier = (value: string): void => {
    if (isRelativeSpecifier(value)) {
      specifiers.add(value);
      return;
    }
    if (!aliasContext) {
      return;
    }
    const resolved = resolvePathAlias(value, aliasContext.tsconfigPaths);
    if (!resolved) {
      return;
    }
    const withoutExt = resolved.replace(/\/index\.tsx?$/, '').replace(/\.tsx?$/, '');
    const relative = toPosixPath(path.relative(aliasContext.fileDir, withoutExt));
    specifiers.add(relative.startsWith('.') ? relative : `./${relative}`);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node)) {
      const [firstArg] = node.arguments;
      if (!firstArg || !ts.isStringLiteralLike(firstArg)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        addSpecifier(firstArg.text);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addSpecifier(firstArg.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return [...specifiers];
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
