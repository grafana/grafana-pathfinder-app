/**
 * Import Graph Infrastructure
 *
 * Utilities for analyzing the import graph of the codebase. Used by
 * architecture.test.ts for boundary enforcement and available for
 * future tooling (dependency visualizers, lint plugins, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';

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

export const TIER_2_ENGINES = Object.entries(TIER_MAP)
  .filter(([, tier]) => tier === 2)
  .map(([dir]) => dir);

export const EXCLUDED_TOP_LEVEL = new Set(['test-utils', 'cli', 'bundled-interactives', 'img', 'locales']);

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
  const segments = relPath.split(path.sep);
  if (segments.length <= 1) {
    return null;
  }
  // ?? null satisfies noUncheckedIndexedAccess; split() always returns at least one element
  return segments[0] ?? null;
}

export function extractRelativeImports(content: string): string[] {
  const specifiers = new Set<string>();

  const fromRegex = /from\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = fromRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  const sideEffectRegex = /^\s*import\s+['"](\.[^'"]+)['"]/gm;
  while ((match = sideEffectRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  const requireRegex = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

export function resolveImportToRelative(fileDir: string, importPath: string): string | null {
  const resolved = path.resolve(fileDir, importPath);
  const relative = path.relative(SRC_DIR, resolved);
  if (relative.startsWith('..')) {
    return null;
  }
  return relative;
}

export function getTargetTopLevel(resolvedRelative: string): string | null {
  const segments = resolvedRelative.split(path.sep);
  // ?? null satisfies noUncheckedIndexedAccess; split() always returns at least one element
  return segments[0] ?? null;
}

let cachedFileImports: FileImports[] | undefined;

export function getAllFileImports(): FileImports[] {
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

/** Reset the cached file imports. Useful for testing. */
export function resetCache(): void {
  cachedFileImports = undefined;
}
