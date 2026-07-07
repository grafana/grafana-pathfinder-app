/**
 * Unit tests for the import graph infrastructure.
 *
 * These test the foundational utilities that architecture.test.ts relies on,
 * ensuring the boundary enforcement logic itself is correct.
 */

import * as path from 'path';

import {
  REPO_ROOT,
  ROOT_LEVEL_ALLOWED_FILES,
  ROOT_LEVEL_TIER_MAP,
  SRC_DIR,
  TIER_MAP,
  TIER_2_ENGINES,
  EXCLUDED_TOP_LEVEL,
  extractRelativeImports,
  getNewViolations,
  getRootLevelSourceFiles,
  getSourceTier,
  getStaleEntries,
  getTargetTopLevel,
  getTopLevelDir,
  isTestFile,
  assertRatchet,
  collectSourceFiles,
  loadTsconfigPaths,
  readJsoncFile,
  resolveImportToRelative,
  resolvePathAlias,
  toPosixPath,
} from './import-graph';

// ---------------------------------------------------------------------------
// extractRelativeImports
// ---------------------------------------------------------------------------

describe('extractRelativeImports', () => {
  it('extracts standard named imports', () => {
    const content = `import { foo } from './utils';`;
    expect(extractRelativeImports(content)).toEqual(['./utils']);
  });

  it('extracts default imports', () => {
    const content = `import foo from './utils';`;
    expect(extractRelativeImports(content)).toEqual(['./utils']);
  });

  it('extracts re-exports', () => {
    const content = `export { bar } from '../lib/helpers';`;
    expect(extractRelativeImports(content)).toEqual(['../lib/helpers']);
  });

  it('extracts wildcard re-exports', () => {
    const content = `export * from './types';`;
    expect(extractRelativeImports(content)).toEqual(['./types']);
  });

  it('extracts side-effect imports', () => {
    const content = `import './polyfills';`;
    expect(extractRelativeImports(content)).toEqual(['./polyfills']);
  });

  it('extracts require() calls', () => {
    const content = `const x = require('./config');`;
    expect(extractRelativeImports(content)).toEqual(['./config']);
  });

  it('ignores bare module specifiers', () => {
    const content = `import React from 'react';\nimport { css } from '@emotion/css';`;
    expect(extractRelativeImports(content)).toEqual([]);
  });

  it('deduplicates multiple imports from the same specifier', () => {
    const content = [`import { a } from './utils';`, `import { b } from './utils';`].join('\n');
    expect(extractRelativeImports(content)).toEqual(['./utils']);
  });

  it('handles multiple distinct specifiers', () => {
    const content = [`import { a } from './foo';`, `import { b } from '../bar';`, `import './side-effect';`].join('\n');
    const result = extractRelativeImports(content);
    expect(result).toHaveLength(3);
    expect(result).toContain('./foo');
    expect(result).toContain('../bar');
    expect(result).toContain('./side-effect');
  });

  it('handles single-quoted and double-quoted imports', () => {
    const content = [`import { a } from './single';`, `import { b } from "./double";`].join('\n');
    const result = extractRelativeImports(content);
    expect(result).toContain('./single');
    expect(result).toContain('./double');
  });

  it('extracts dynamic import() specifiers', () => {
    const content = `const mod = await import('./dynamic');`;
    expect(extractRelativeImports(content)).toEqual(['./dynamic']);
  });

  it('ignores import-like strings in comments and string literals', () => {
    const content = [
      `// from './comment-only'`,
      `const str = "from './inside-string'";`,
      `/* require('./also-comment') */`,
      `import { real } from './actual';`,
    ].join('\n');
    expect(extractRelativeImports(content)).toEqual(['./actual']);
  });
});

// ---------------------------------------------------------------------------
// extractRelativeImports with alias resolution
// ---------------------------------------------------------------------------

describe('extractRelativeImports with an alias context', () => {
  const tsconfigPaths = { configDir: path.join(REPO_ROOT, '.config'), paths: { '*': ['../src/*'] } };

  it('resolves a bare specifier matching a real src/ file to a relative path', () => {
    const content = `import { foo } from 'validation/import-graph';`;
    const fileDir = path.join(SRC_DIR, 'components');
    expect(extractRelativeImports(content, { fileDir, tsconfigPaths })).toEqual(['../validation/import-graph']);
  });

  it('resolves a bare specifier matching a barrel directory to its index', () => {
    const content = `import { useSomething } from 'hooks';`;
    const fileDir = path.join(SRC_DIR, 'components');
    expect(extractRelativeImports(content, { fileDir, tsconfigPaths })).toEqual(['../hooks']);
  });

  it('still ignores npm package names with no matching file under src/', () => {
    const content = `import React from 'react';\nimport { css } from '@emotion/css';`;
    const fileDir = path.join(SRC_DIR, 'components');
    expect(extractRelativeImports(content, { fileDir, tsconfigPaths })).toEqual([]);
  });

  it('does not attempt alias resolution when no alias context is given (no regression)', () => {
    const content = `import { foo } from 'validation/import-graph';`;
    expect(extractRelativeImports(content)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readJsoncFile / loadTsconfigPaths
// ---------------------------------------------------------------------------

describe('readJsoncFile', () => {
  it('parses the real .config/tsconfig.json, stripping comments', () => {
    const parsed = readJsoncFile<{ compilerOptions?: { paths?: Record<string, string[]> } }>(
      path.join(REPO_ROOT, '.config', 'tsconfig.json')
    );
    expect(parsed.compilerOptions?.paths).toEqual({ '*': ['../src/*'] });
  });
});

describe('loadTsconfigPaths', () => {
  it('resolves configDir relative to the tsconfig file location', () => {
    const tsconfigPath = path.join(REPO_ROOT, '.config', 'tsconfig.json');
    const result = loadTsconfigPaths(tsconfigPath);
    expect(result).toEqual({ configDir: path.dirname(tsconfigPath), paths: { '*': ['../src/*'] } });
  });
});

// ---------------------------------------------------------------------------
// resolvePathAlias
// ---------------------------------------------------------------------------

describe('resolvePathAlias', () => {
  const tsconfigPaths = { configDir: path.join(REPO_ROOT, '.config'), paths: { '*': ['../src/*'] } };

  it('resolves a bare specifier to a real file under src/', () => {
    expect(resolvePathAlias('validation/import-graph', tsconfigPaths)).toBe(
      path.join(SRC_DIR, 'validation', 'import-graph.ts')
    );
  });

  it('resolves a bare specifier to a directory index file', () => {
    expect(resolvePathAlias('hooks', tsconfigPaths)).toBe(path.join(SRC_DIR, 'hooks', 'index.ts'));
  });

  it('returns null for an npm package name with no matching file under src/', () => {
    expect(resolvePathAlias('react', tsconfigPaths)).toBeNull();
    expect(resolvePathAlias('@emotion/css', tsconfigPaths)).toBeNull();
  });

  it('returns null when no configured pattern matches the specifier', () => {
    expect(resolvePathAlias('foo', { configDir: SRC_DIR, paths: { '@app/*': ['./app/*'] } })).toBeNull();
  });

  it('substitutes the wildcard capture into the target pattern', () => {
    expect(resolvePathAlias('@app/validation/import-graph', { configDir: SRC_DIR, paths: { '@app/*': ['./*'] } })).toBe(
      path.join(SRC_DIR, 'validation', 'import-graph.ts')
    );
  });

  it('matches an exact non-wildcard pattern', () => {
    expect(
      resolvePathAlias('root-constants', { configDir: SRC_DIR, paths: { 'root-constants': ['./constants.ts'] } })
    ).toBe(path.join(SRC_DIR, 'constants.ts'));
  });
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  it('detects .test.ts files', () => {
    expect(isTestFile(path.join(SRC_DIR, 'utils', 'foo.test.ts'))).toBe(true);
  });

  it('detects .test.tsx files', () => {
    expect(isTestFile(path.join(SRC_DIR, 'components', 'Bar.test.tsx'))).toBe(true);
  });

  it('detects .spec.ts files', () => {
    expect(isTestFile(path.join(SRC_DIR, 'lib', 'helper.spec.ts'))).toBe(true);
  });

  it('detects files under test-utils/', () => {
    expect(isTestFile(path.join(SRC_DIR, 'test-utils', 'render.ts'))).toBe(true);
  });

  it('detects files under __tests__/', () => {
    expect(isTestFile(path.join(SRC_DIR, 'utils', '__tests__', 'helper.ts'))).toBe(true);
  });

  it('returns false for regular source files', () => {
    expect(isTestFile(path.join(SRC_DIR, 'utils', 'helpers.ts'))).toBe(false);
  });

  it('returns false for files with "test" in the name but not as suffix', () => {
    expect(isTestFile(path.join(SRC_DIR, 'utils', 'test-helpers.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTopLevelDir
// ---------------------------------------------------------------------------

describe('getTopLevelDir', () => {
  it('returns the first segment for multi-segment paths', () => {
    expect(getTopLevelDir(path.join('utils', 'helpers.ts'))).toBe('utils');
  });

  it('returns the first segment for deeply nested paths', () => {
    expect(getTopLevelDir(path.join('components', 'docs-panel', 'panel.tsx'))).toBe('components');
  });

  it('returns null for single-segment paths (files in src root)', () => {
    expect(getTopLevelDir('module.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveImportToRelative
// ---------------------------------------------------------------------------

describe('resolveImportToRelative', () => {
  it('resolves a sibling import to a relative path', () => {
    const fileDir = path.join(SRC_DIR, 'utils');
    const result = resolveImportToRelative(fileDir, './helpers');
    expect(result).toBe(path.join('utils', 'helpers'));
  });

  it('resolves a parent-relative import', () => {
    const fileDir = path.join(SRC_DIR, 'utils', 'sub');
    const result = resolveImportToRelative(fileDir, '../types');
    expect(result).toBe(path.join('utils', 'types'));
  });

  it('resolves cross-directory imports', () => {
    const fileDir = path.join(SRC_DIR, 'components');
    const result = resolveImportToRelative(fileDir, '../lib/analytics');
    expect(result).toBe(path.join('lib', 'analytics'));
  });

  it('returns null for imports that escape SRC_DIR', () => {
    const fileDir = SRC_DIR;
    const result = resolveImportToRelative(fileDir, '../../outside');
    expect(result).toBeNull();
  });

  it('normalizes resolved paths to posix separators', () => {
    const fileDir = path.join(SRC_DIR, 'utils');
    const result = resolveImportToRelative(fileDir, './helpers');
    expect(result).toBe('utils/helpers');
  });
});

// ---------------------------------------------------------------------------
// getTargetTopLevel
// ---------------------------------------------------------------------------

describe('getTargetTopLevel', () => {
  it('returns the first segment of a resolved path', () => {
    expect(getTargetTopLevel(path.join('lib', 'analytics'))).toBe('lib');
  });

  it('returns the name for a single-segment path', () => {
    expect(getTargetTopLevel('types')).toBe('types');
  });
});

// ---------------------------------------------------------------------------
// getSourceTier
// ---------------------------------------------------------------------------

describe('getSourceTier', () => {
  it('returns the TIER_MAP tier for a file in a known top-level directory', () => {
    expect(getSourceTier('lib/foo.ts', 'lib')).toBe(TIER_MAP['lib']);
  });

  it('returns the TIER_MAP tier regardless of file path depth', () => {
    expect(getSourceTier('components/nested/deeply/widget.tsx', 'components')).toBe(TIER_MAP['components']);
  });

  it('returns the ROOT_LEVEL_TIER_MAP tier for a root-level file', () => {
    expect(getSourceTier('module.tsx', null)).toBe(ROOT_LEVEL_TIER_MAP['module.tsx']);
    expect(getSourceTier('constants.ts', null)).toBe(ROOT_LEVEL_TIER_MAP['constants.ts']);
  });

  it('returns undefined for an unknown top-level directory', () => {
    expect(getSourceTier('phantom/foo.ts', 'phantom')).toBeUndefined();
  });

  it('returns undefined for an unknown root-level file', () => {
    expect(getSourceTier('helpers.ts', null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TIER_MAP / TIER_2_ENGINES / EXCLUDED_TOP_LEVEL consistency
// ---------------------------------------------------------------------------

describe('architecture constants', () => {
  it('TIER_2_ENGINES is derived from TIER_MAP', () => {
    const expected = Object.entries(TIER_MAP)
      .filter(([, tier]) => tier === 2)
      .map(([dir]) => dir);
    expect(TIER_2_ENGINES).toEqual(expected);
  });

  it('TIER_MAP and EXCLUDED_TOP_LEVEL do not overlap', () => {
    const overlap = Object.keys(TIER_MAP).filter((dir) => EXCLUDED_TOP_LEVEL.has(dir));
    expect(overlap).toEqual([]);
  });

  it('ROOT_LEVEL_ALLOWED_FILES contains only source files that exist in src root', () => {
    const rootLevelSourceFiles = getRootLevelSourceFiles();
    const invalidEntries = [...ROOT_LEVEL_ALLOWED_FILES].filter((file) => !rootLevelSourceFiles.includes(file));
    expect(invalidEntries).toEqual([]);
  });

  it('ROOT_LEVEL_ALLOWED_FILES is derived from ROOT_LEVEL_TIER_MAP (single source of truth)', () => {
    expect([...ROOT_LEVEL_ALLOWED_FILES].sort()).toEqual(Object.keys(ROOT_LEVEL_TIER_MAP).sort());
  });

  it('every ROOT_LEVEL_TIER_MAP tier is a valid tier in TIER_MAP', () => {
    const validTiers = new Set(Object.values(TIER_MAP));
    for (const [file, tier] of Object.entries(ROOT_LEVEL_TIER_MAP)) {
      expect({ file, tier, isValid: validTiers.has(tier) }).toEqual({ file, tier, isValid: true });
    }
  });
});

// ---------------------------------------------------------------------------
// collectSourceFiles
// ---------------------------------------------------------------------------

describe('collectSourceFiles', () => {
  it('returns only .ts and .tsx files', () => {
    const files = collectSourceFiles();
    for (const file of files) {
      expect(file).toMatch(/\.(ts|tsx)$/);
    }
  });

  it('excludes .d.ts files', () => {
    const files = collectSourceFiles();
    const dtsFiles = files.filter((f) => f.endsWith('.d.ts'));
    expect(dtsFiles).toEqual([]);
  });

  it('excludes files from EXCLUDED_TOP_LEVEL directories', () => {
    const files = collectSourceFiles();
    for (const file of files) {
      const rel = path.relative(SRC_DIR, file);
      const topLevel = rel.split(path.sep)[0];
      if (topLevel) {
        expect(EXCLUDED_TOP_LEVEL.has(topLevel)).toBe(false);
      }
    }
  });

  it('returns a non-empty list', () => {
    expect(collectSourceFiles().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// path normalization helpers
// ---------------------------------------------------------------------------

describe('toPosixPath', () => {
  it('normalizes windows-style separators', () => {
    expect(toPosixPath('foo\\bar\\baz.ts')).toBe('foo/bar/baz.ts');
  });

  it('leaves posix paths unchanged', () => {
    expect(toPosixPath('foo/bar/baz.ts')).toBe('foo/bar/baz.ts');
  });
});

// ---------------------------------------------------------------------------
// getNewViolations / getStaleEntries
// ---------------------------------------------------------------------------

describe('getNewViolations', () => {
  it('returns violations not present in the allowlist', () => {
    const violations = new Set(['a -> b', 'c -> d']);
    const allowlist = new Set(['a -> b']);
    expect(getNewViolations(violations, allowlist)).toEqual(['c -> d']);
  });

  it('returns empty when all violations are allowed', () => {
    const both = new Set(['a -> b']);
    expect(getNewViolations(both, both)).toEqual([]);
  });

  it('returns empty for empty violations', () => {
    expect(getNewViolations(new Set(), new Set(['stale']))).toEqual([]);
  });
});

describe('getStaleEntries', () => {
  it('returns allowlist entries not present in violations', () => {
    const violations = new Set(['a -> b']);
    const allowlist = new Set(['a -> b', 'old -> gone']);
    expect(getStaleEntries(violations, allowlist)).toEqual(['old -> gone']);
  });

  it('returns empty when allowlist matches violations', () => {
    const both = new Set(['a -> b']);
    expect(getStaleEntries(both, both)).toEqual([]);
  });

  it('returns all entries when violations are empty', () => {
    const allowlist = new Set(['x', 'y']);
    expect(getStaleEntries(new Set(), allowlist)).toEqual(['x', 'y']);
  });
});

// ---------------------------------------------------------------------------
// assertRatchet
// ---------------------------------------------------------------------------

describe('assertRatchet', () => {
  const advice = 'Fix it by restructuring the import.';

  it('passes when both sets are empty', () => {
    expect(() => assertRatchet(new Set(), new Set(), 'test', 'TEST_CONST', advice)).not.toThrow();
  });

  it('passes when violations exactly match the allowlist', () => {
    const set = new Set(['a -> b', 'c -> d']);
    expect(() => assertRatchet(set, new Set(set), 'test', 'TEST_CONST', advice)).not.toThrow();
  });

  it('throws on new violations with the violation key in the message', () => {
    const violations = new Set(['a -> b', 'new -> violation']);
    const allowlist = new Set(['a -> b']);
    expect(() => assertRatchet(violations, allowlist, 'tier violations', 'ALLOWED', advice)).toThrow(
      /new -> violation/
    );
  });

  it('throws on new violations with the advice text', () => {
    const violations = new Set(['new -> one']);
    expect(() => assertRatchet(violations, new Set(), 'test', 'CONST', advice)).toThrow(/Fix it by restructuring/);
  });

  it('throws on stale entries with the allowlist constant name', () => {
    const violations = new Set<string>();
    const allowlist = new Set(['stale -> entry']);
    expect(() => assertRatchet(violations, allowlist, 'tier violations', 'MY_ALLOWLIST', advice)).toThrow(
      /MY_ALLOWLIST/
    );
  });

  it('throws on stale entries with the entry in the message', () => {
    const violations = new Set(['a -> b']);
    const allowlist = new Set(['a -> b', 'gone -> removed']);
    expect(() => assertRatchet(violations, allowlist, 'test', 'CONST', advice)).toThrow(/gone -> removed/);
  });

  it('prioritizes new violations over stale entries when both exist', () => {
    const violations = new Set(['new -> one']);
    const allowlist = new Set(['stale -> old']);
    expect(() => assertRatchet(violations, allowlist, 'test', 'CONST', advice)).toThrow(/New test detected/);
  });
});
