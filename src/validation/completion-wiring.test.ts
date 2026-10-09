/**
 * Completion wiring ratchet
 *
 * A guide-rendering surface used to build a SurfaceCompletionInput, register
 * the guide identity and forward a terminal completion to the recorder itself.
 * Three surfaces each did it by hand, and a fourth that forgot any of it type
 * checked, rendered correctly and recorded nothing. ContentRenderer now owns
 * that wiring behind its required `completion` prop, so each of the symbols
 * below has exactly one production user.
 *
 * The population is derived from the source, not listed: every non-test module
 * under src/ is parsed, and any use of a guarded symbol (a call, a reference
 * passed as a value, or an aliased import of it) outside its owning module is a
 * violation. Declarations and import/export specifiers are not uses, so the
 * barrel re-exports and the definitions themselves do not count.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import {
  ARCHITECTURE_BY_DESIGN,
  SRC_DIR,
  assertRatchet,
  collectSourceFiles,
  isTestFile,
  toPosixPath,
  validateAllowedArchitectureEntries,
  type AllowedArchitectureEntry,
} from './import-graph';

const CONTENT_RENDERER = 'components/content-renderer/content-renderer.tsx';

const GUARDED_SYMBOLS: Readonly<Record<string, string>> = {
  useGuideIdentityRegistration: CONTENT_RENDERER,
  registerGuideIdentity: 'components/content-renderer/useGuideIdentityRegistration.ts',
  recordGuideCompletionForSurface: CONTENT_RENDERER,
};

// A use here needs a reason a surface cannot get the same result from ContentRenderer.
const ALLOWED_OUTSIDE_USES: readonly AllowedArchitectureEntry[] = [];

const ADVICE =
  'Completion wiring has one home: ContentRenderer (src/components/content-renderer/content-renderer.tsx). ' +
  'It registers the guide identity and records the terminal completion for the `completion` prop it is mounted with.\n\n' +
  'To add a guide-rendering surface: build a SurfaceCompletionInput, pass ' +
  "`completion={{ kind: 'tracked', input }}` to <ContentRenderer>, and publish the surface's content key with " +
  'usePublishSurfaceContentKey. Do NOT call useGuideIdentityRegistration, registerGuideIdentity or ' +
  'recordGuideCompletionForSurface yourself: a second wiring point is how a surface ends up registering one identity ' +
  'and recording another, or recording nothing at all.\n\n' +
  "A mount that must record nothing (a preview) passes `completion={{ kind: 'untracked', reason: 'preview' }}`.\n\n" +
  'To add a way to FINISH a guide, route through ContentRenderer\'s terminal triggers. See "Extension checklists" in ' +
  'docs/developer/COMPLETION_RECORDING.md.\n\n' +
  'Only if this use is a deliberate, reviewed exception that ContentRenderer cannot serve, add an entry to ' +
  'ALLOWED_OUTSIDE_USES with a substantive reason and a tracking issue; a sibling test requires both.';

function importedAliases(sourceFile: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  sourceFile.forEachChild(function visit(node) {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (imported in GUARDED_SYMBOLS) {
        aliases.set(node.name.text, imported);
      }
    }
    node.forEachChild(visit);
  });
  return aliases;
}

function isDeclarationOrSpecifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ((ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name === node)
  );
}

function usedSymbols(sourceFile: ts.SourceFile): Set<string> {
  const aliases = importedAliases(sourceFile);
  const used = new Set<string>();
  sourceFile.forEachChild(function visit(node) {
    if (ts.isIdentifier(node) && !isDeclarationOrSpecifier(node)) {
      const symbol = aliases.get(node.text) ?? (node.text in GUARDED_SYMBOLS ? node.text : undefined);
      if (symbol) {
        used.add(symbol);
      }
    }
    node.forEachChild(visit);
  });
  return used;
}

function scanSource(relPath: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return usedSymbols(sourceFile);
}

function scanProduction(): { uses: Map<string, Set<string>>; filesScanned: number } {
  const uses = new Map<string, Set<string>>(Object.keys(GUARDED_SYMBOLS).map((symbol) => [symbol, new Set()]));
  const files = collectSourceFiles().filter((file) => !isTestFile(file));
  for (const file of files) {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    for (const symbol of scanSource(relPath, fs.readFileSync(file, 'utf-8'))) {
      uses.get(symbol)?.add(relPath);
    }
  }
  return { uses, filesScanned: files.length };
}

describe('completion wiring ratchet', () => {
  const { uses, filesScanned } = scanProduction();

  it('scans the production tree and finds each guarded symbol in its owner', () => {
    expect(filesScanned).toBeGreaterThan(100);
    for (const [symbol, owner] of Object.entries(GUARDED_SYMBOLS)) {
      if (!uses.get(symbol)?.has(owner)) {
        throw new Error(
          `${owner} no longer uses ${symbol}. This guard exists to keep completion wiring in one place; a scan ` +
            'that cannot see the owner would pass while checking nothing. If the wiring moved, update ' +
            'GUARDED_SYMBOLS to its new owner in the same change.\n\n' +
            ADVICE
        );
      }
    }
  });

  it('keeps identity registration and completion recording behind ContentRenderer', () => {
    const violations = new Set<string>();
    for (const [symbol, owner] of Object.entries(GUARDED_SYMBOLS)) {
      for (const file of uses.get(symbol) ?? []) {
        if (file !== owner) {
          violations.add(`${symbol} used in ${file}`);
        }
      }
    }
    const allowlist = new Set(ALLOWED_OUTSIDE_USES.map((entry) => entry.violation));

    assertRatchet(
      violations,
      allowlist,
      'uses of completion wiring outside ContentRenderer',
      'ALLOWED_OUTSIDE_USES',
      ADVICE
    );
  });

  it('every allowlist entry is justified and accountable', () => {
    const errors = validateAllowedArchitectureEntries(ALLOWED_OUTSIDE_USES, { allowByDesign: false });
    if (errors.length > 0) {
      throw new Error(
        `ALLOWED_OUTSIDE_USES entries must each carry a justification and an accountability reference:\n${errors
          .map((error) => `  - ${error}`)
          .join('\n')}\n\n'${ARCHITECTURE_BY_DESIGN}' is never valid here.`
      );
    }
  });
});

describe('completion wiring ratchet: detector', () => {
  it('flags a call, an aliased call and a bare reference', () => {
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import { recordGuideCompletionForSurface as record } from '../../docs-retrieval';
         record(input);`
      )
    ).toEqual(new Set(['recordGuideCompletionForSurface']));
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import { useGuideIdentityRegistration } from '../content-renderer/useGuideIdentityRegistration';
         useGuideIdentityRegistration(url, input);`
      )
    ).toEqual(new Set(['useGuideIdentityRegistration']));
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import { registerGuideIdentity } from '../../completion-records';
         const forward = registerGuideIdentity;`
      )
    ).toEqual(new Set(['registerGuideIdentity']));
  });

  it('flags a call through a namespace import', () => {
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import * as retrieval from '../../docs-retrieval';
         retrieval.recordGuideCompletionForSurface(input);`
      )
    ).toEqual(new Set(['recordGuideCompletionForSurface']));
  });

  it('ignores a declaration, an import and a re-export', () => {
    expect(
      scanSource(
        'docs-retrieval/index.ts',
        `export { recordGuideCompletionForSurface } from './learning-journey-helpers';
         export function registerGuideIdentity() {}
         import { useGuideIdentityRegistration } from './hook';`
      )
    ).toEqual(new Set());
  });
});
