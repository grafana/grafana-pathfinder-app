/**
 * Unit tests for the import graph infrastructure.
 *
 * These test the foundational utilities that architecture.test.ts relies on,
 * ensuring the boundary enforcement logic itself is correct.
 */

import * as path from 'path';

import {
  SRC_DIR,
  TIER_MAP,
  TIER_2_ENGINES,
  EXCLUDED_TOP_LEVEL,
  isTestFile,
  getTopLevelDir,
  extractRelativeImports,
  resolveImportToRelative,
  getTargetTopLevel,
  collectSourceFiles,
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

  it('does not extract dynamic import() — known limitation', () => {
    const content = `const mod = await import('./dynamic');`;
    expect(extractRelativeImports(content)).toEqual([]);
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
