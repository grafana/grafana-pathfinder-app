/**
 * Ratchet (#1519): `checkRequirements` / `checkPostconditions` resolve `var-*`
 * against the compatibility guide identity unless the caller threads a
 * `guideId`. Renderer-owned code must go through `useGuideRequirements()`,
 * which binds the identity of the `ContentRenderer` it is mounted under.
 *
 * A new direct importer would silently reintroduce the cross-guide read with no
 * failing test, so the legitimate consumers are pinned here. Adding an entry is
 * a deliberate act: the file must genuinely have no renderer identity to bind.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const UNSCOPED_EXPORTS = ['checkRequirements', 'checkPostconditions'];

const CHECKER_MODULES = ['src/requirements-manager/requirements-checker.utils.ts', 'src/requirements-manager/index.ts'];

const ALLOWED_UNSCOPED_CONSUMERS = [
  // The barrel re-export itself, and the scoped provider that wraps it.
  'src/requirements-manager/index.ts',
  'src/requirements-manager/guide-requirements-context.tsx',
  // The live tab answers a controller's round-trip. It has no renderer of its
  // own to bind, and the controller now keeps `var-*` on its own side, so what
  // reaches here is DOM/URL/session only (see controller-requirements.ts).
  'src/integrations/cross-tab/live-tab-executor.ts',
];

// `export … from` counts too: re-exporting the unscoped checker hands it to a
// consumer the resolver would otherwise never see.
const REEXPORT_PATTERN = /(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src'], { cwd: REPO_ROOT, encoding: 'utf-8' })
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));
}

/** Repo-relative path of the module a relative specifier resolves to. */
function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = path.resolve(path.dirname(path.join(REPO_ROOT, fromFile)), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  const hit = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return hit ? path.relative(REPO_ROOT, hit) : undefined;
}

function importsUnscopedChecker(file: string): boolean {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  for (const [, typeOnly, bindings, specifier] of source.matchAll(REEXPORT_PATTERN)) {
    if (typeOnly) {
      continue;
    }
    const resolved = resolveSpecifier(file, specifier!);
    if (!resolved || !CHECKER_MODULES.includes(resolved)) {
      continue;
    }
    const imported = bindings!.split(',').map((binding) =>
      binding
        .trim()
        .split(/\s+as\s+/)[0]!
        .trim()
    );
    if (imported.some((name) => UNSCOPED_EXPORTS.includes(name))) {
      return true;
    }
  }
  return false;
}

describe('unscoped requirements checkers (#1519)', () => {
  it('is imported only by the allowlisted consumers', () => {
    const offenders = trackedSourceFiles()
      .filter((file) => !ALLOWED_UNSCOPED_CONSUMERS.includes(file))
      .filter(importsUnscopedChecker);

    expect(offenders).toEqual([]);
  });

  // Positive control: every allowlisted file must still be a real consumer, so
  // the detector cannot silently stop matching and the list cannot go stale.
  it.each(ALLOWED_UNSCOPED_CONSUMERS)('%s still consumes the unscoped checkers', (file) => {
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    expect(importsUnscopedChecker(file)).toBe(true);
  });
});
