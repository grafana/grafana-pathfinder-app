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
 *
 * The same scan guards the rest of the completion seam: direct guide-percentage
 * dispatches, the terminal recorder, and every reset or clear entry point. Their
 * legitimate callers are a named allowlist derived from the source, so a new
 * caller fails here instead of quietly bypassing the seam.
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

const COMPLETION_STORE = 'global-state/completion-store.ts';
const DISPATCH_PROGRESS = 'dispatchProgress';

const SEAM_ENTRY_POINTS: Readonly<Record<string, string>> = {
  recordGuideCompletion: 'completion-records/completion-recorder.ts',
  invalidateEmittedCompletion: 'completion-records/completion-recorder.ts',
  invalidateAllEmittedCompletions: 'completion-records/completion-recorder.ts',
  clearAttempt: 'completion-records/guide-attempts.ts',
  clearAllAttempts: 'completion-records/guide-attempts.ts',
  discardQueuedCompletionWrites: 'completion-records/completion-write-hook.ts',
  resetGuideProgress: 'components/docs-panel/hooks/resetGuideProgress.ts',
};

const GUIDE_DISPATCH_VIOLATION = (file: string) => `dispatchProgress({ kind: 'guide' }) called in ${file}`;

const ALLOWED_SEAM_USES: readonly AllowedArchitectureEntry[] = [
  {
    violation: GUIDE_DISPATCH_VIOLATION('components/mark-complete/MarkCompleteFooter.tsx'),
    reason:
      'The Mark complete control is a terminal path: it announces 100 with no origin, which the observer ignores.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: GUIDE_DISPATCH_VIOLATION('docs-retrieval/learning-journey-helpers.ts'),
    reason: 'markMilestoneDone and the legacy milestone backfill announce a terminal 100 with no origin.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'recordGuideCompletion used in docs-retrieval/learning-journey-helpers.ts',
    reason:
      'recordGuideCompletionForSurface is the single surface-neutral router that decides eligibility and calls the recorder.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'invalidateEmittedCompletion used in components/docs-panel/hooks/resetGuideProgress.ts',
    reason: 'resetGuideProgress is the reset entry point: it clears storage, then lifts both guards and the attempt.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'invalidateEmittedCompletion used in learning-paths/learning-paths.hook.ts',
    reason: 'Resetting a learning path re-arms each member guide, which has no surface-owned storage to clear.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'invalidateAllEmittedCompletions used in components/LearningPaths/MyLearningTab.tsx',
    reason: 'My Learning reset-all clears every guide at once, so it lifts every guard and every attempt.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'discardQueuedCompletionWrites used in components/LearningPaths/MyLearningTab.tsx',
    reason:
      'Reset-all drops queued partials before any await, because a scheduled drain can fire between the reset and the clear.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'clearAttempt used in completion-records/completion-recorder.ts',
    reason: 'invalidateEmittedCompletion is the only caller: attempt state is cleared together with the durable guard.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'clearAllAttempts used in completion-records/completion-recorder.ts',
    reason:
      'invalidateAllEmittedCompletions is the only caller: attempt state is cleared together with every durable guard.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'resetGuideProgress used in components/docs-panel/hooks/useContentReset.ts',
    reason: 'The reset-guide button and the guide reset hook route through the shared reset entry point.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'resetGuideProgress used in components/docs-panel/hooks/useE2EResetGuideCapability.ts',
    reason: 'The end-to-end reset capability drives the same reset entry point a reader reaches from the UI.',
    tracking: ARCHITECTURE_BY_DESIGN,
  },
];

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

type GuardedSymbols = Readonly<Record<string, string>>;

const SEAM_ADVICE =
  'The completion seam has one producer of guide progress and one route to each terminal or reset effect. ' +
  'A new caller of these entry points is how progress goes unrecorded, a completion is recorded twice, or a reset ' +
  'leaves a closed attempt behind.\n\n' +
  'To record progress: write evidence through markStepCompleted / markStepsCompleted in ' +
  "src/global-state/completion-store.ts. Never call dispatchProgress({ kind: 'guide' }) yourself.\n\n" +
  "To finish a guide: route through ContentRenderer's terminal triggers, which reach recordGuideCompletionForSurface. " +
  'Do not call recordGuideCompletion.\n\n' +
  'To reset: go through resetGuideProgress, or invalidateEmittedCompletion / invalidateAllEmittedCompletions, so the ' +
  'attempt and queued partials clear with the storage. See "Extension checklists" in ' +
  'docs/developer/COMPLETION_RECORDING.md.\n\n' +
  'Only if this caller is a deliberate, reviewed part of the seam, add an entry to ALLOWED_SEAM_USES with a ' +
  "substantive reason and either a tracking issue or '" +
  ARCHITECTURE_BY_DESIGN +
  "' for a permanent boundary.";

function importedAliases(sourceFile: ts.SourceFile, guarded: GuardedSymbols): Map<string, string> {
  const aliases = new Map<string, string>();
  sourceFile.forEachChild(function visit(node) {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (imported in guarded) {
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

function usedSymbols(sourceFile: ts.SourceFile, guarded: GuardedSymbols): Set<string> {
  const aliases = importedAliases(sourceFile, guarded);
  const used = new Set<string>();
  sourceFile.forEachChild(function visit(node) {
    if (ts.isIdentifier(node) && !isDeclarationOrSpecifier(node)) {
      const symbol = aliases.get(node.text) ?? (node.text in guarded ? node.text : undefined);
      if (symbol) {
        used.add(symbol);
      }
    }
    node.forEachChild(visit);
  });
  return used;
}

function parse(relPath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function scanSource(relPath: string, source: string, guarded: GuardedSymbols = GUARDED_SYMBOLS): Set<string> {
  return usedSymbols(parse(relPath, source), guarded);
}

function isKnownNonGuideDetail(detail: ts.Expression | undefined): boolean {
  if (!detail || !ts.isObjectLiteralExpression(detail)) {
    return false;
  }
  if (detail.properties.some((property) => ts.isSpreadAssignment(property))) {
    return false;
  }
  const kind = detail.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'kind'
  );
  return (
    kind !== undefined &&
    (ts.isStringLiteral(kind.initializer) || ts.isNoSubstitutionTemplateLiteral(kind.initializer)) &&
    kind.initializer.text !== 'guide'
  );
}

function callOf(identifier: ts.Identifier): ts.CallExpression | undefined {
  const parent = identifier.parent;
  if (ts.isCallExpression(parent) && parent.expression === identifier) {
    return parent;
  }
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.name === identifier &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return parent.parent;
  }
  return undefined;
}

function dispatchesGuideProgress(relPath: string, source: string): boolean {
  const sourceFile = parse(relPath, source);
  const aliases = importedAliases(sourceFile, { [DISPATCH_PROGRESS]: '' });
  let found = false;
  sourceFile.forEachChild(function visit(node) {
    if (ts.isIdentifier(node) && !isDeclarationOrSpecifier(node)) {
      if (aliases.get(node.text) === DISPATCH_PROGRESS || node.text === DISPATCH_PROGRESS) {
        const call = callOf(node);
        found = found || call === undefined || !isKnownNonGuideDetail(call.arguments[0]);
      }
    }
    node.forEachChild(visit);
  });
  return found;
}

interface ProductionScan {
  uses: Map<string, Set<string>>;
  seamUses: Map<string, Set<string>>;
  guideDispatchers: Set<string>;
  filesScanned: number;
}

function scanProduction(): ProductionScan {
  const uses = new Map<string, Set<string>>(Object.keys(GUARDED_SYMBOLS).map((symbol) => [symbol, new Set()]));
  const seamUses = new Map<string, Set<string>>(Object.keys(SEAM_ENTRY_POINTS).map((symbol) => [symbol, new Set()]));
  const guideDispatchers = new Set<string>();
  const files = collectSourceFiles().filter((file) => !isTestFile(file));
  for (const file of files) {
    const relPath = toPosixPath(path.relative(SRC_DIR, file));
    const source = fs.readFileSync(file, 'utf-8');
    for (const symbol of scanSource(relPath, source)) {
      uses.get(symbol)?.add(relPath);
    }
    for (const symbol of scanSource(relPath, source, SEAM_ENTRY_POINTS)) {
      seamUses.get(symbol)?.add(relPath);
    }
    if (dispatchesGuideProgress(relPath, source)) {
      guideDispatchers.add(relPath);
    }
  }
  return { uses, seamUses, guideDispatchers, filesScanned: files.length };
}

describe('completion wiring ratchet', () => {
  const { uses, seamUses, guideDispatchers, filesScanned } = scanProduction();

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

  it('finds each seam entry point and the guide producer in the tree', () => {
    for (const symbol of Object.keys(SEAM_ENTRY_POINTS)) {
      if ((seamUses.get(symbol)?.size ?? 0) === 0) {
        throw new Error(
          `${symbol} has no caller in the production tree. A scan that sees no caller would pass while checking ` +
            'nothing. If it was renamed or removed, update SEAM_ENTRY_POINTS and ALLOWED_SEAM_USES in the same change.\n\n' +
            SEAM_ADVICE
        );
      }
    }
    if (!guideDispatchers.has(COMPLETION_STORE)) {
      throw new Error(
        `${COMPLETION_STORE} no longer dispatches guide progress, so the scan cannot see the producer. If it moved, ` +
          'update COMPLETION_STORE in the same change.\n\n' +
          SEAM_ADVICE
      );
    }
  });

  it('keeps guide progress, terminal recording and resets behind the seam', () => {
    const violations = new Set<string>();
    for (const [symbol, definedIn] of Object.entries(SEAM_ENTRY_POINTS)) {
      for (const file of seamUses.get(symbol) ?? []) {
        if (file !== definedIn) {
          violations.add(`${symbol} used in ${file}`);
        }
      }
    }
    for (const file of guideDispatchers) {
      if (file !== COMPLETION_STORE) {
        violations.add(GUIDE_DISPATCH_VIOLATION(file));
      }
    }
    const allowlist = new Set(ALLOWED_SEAM_USES.map((entry) => entry.violation));

    assertRatchet(
      violations,
      allowlist,
      'callers of the completion seam entry points',
      'ALLOWED_SEAM_USES',
      SEAM_ADVICE
    );
  });

  it('every seam allowlist entry is justified and accountable', () => {
    const errors = validateAllowedArchitectureEntries(ALLOWED_SEAM_USES, { allowByDesign: true });
    if (errors.length > 0) {
      throw new Error(
        `ALLOWED_SEAM_USES entries must each carry a justification and an accountability reference:\n${errors
          .map((error) => `  - ${error}`)
          .join('\n')}`
      );
    }
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

describe('completion seam ratchet: detector', () => {
  const flags = (source: string): boolean => dispatchesGuideProgress('components/new-surface/Surface.tsx', source);

  it('flags a guide dispatch, an aliased one and one through a namespace', () => {
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             dispatchProgress({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });`)
    ).toBe(true);
    expect(
      flags(`import { dispatchProgress as announce } from '../../global-state/progress-events';
             announce({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });`)
    ).toBe(true);
    expect(
      flags(`import * as events from '../../global-state/progress-events';
             events.dispatchProgress({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });`)
    ).toBe(true);
  });

  it('flags a dispatch whose kind it cannot read and a bare reference', () => {
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             dispatchProgress(detail);`)
    ).toBe(true);
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             dispatchProgress({ kind, contentKey });`)
    ).toBe(true);
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             dispatchProgress({ ...base, percentage: 100 });`)
    ).toBe(true);
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             const forward = dispatchProgress;`)
    ).toBe(true);
  });

  it('ignores step and section dispatches, a declaration and a re-export', () => {
    expect(
      flags(`import { dispatchProgress } from '../../global-state/progress-events';
             dispatchProgress({ kind: 'step', stepId, completed: true, reason: 'manual' });
             dispatchProgress({ kind: 'section', contentKey, sectionId, completed: true, hydrated: false });`)
    ).toBe(false);
    expect(
      flags(`export function dispatchProgress(detail) {}
             export { dispatchProgress } from './progress-events';`)
    ).toBe(false);
  });

  it('flags a call, an aliased call and a namespace call of a seam entry point', () => {
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import { recordGuideCompletion as record } from '../../completion-records';
         record(fact);`,
        SEAM_ENTRY_POINTS
      )
    ).toEqual(new Set(['recordGuideCompletion']));
    expect(
      scanSource(
        'components/new-surface/Surface.tsx',
        `import * as records from '../../completion-records';
         records.clearAllAttempts();
         records.invalidateEmittedCompletion(source, id);`,
        SEAM_ENTRY_POINTS
      )
    ).toEqual(new Set(['clearAllAttempts', 'invalidateEmittedCompletion']));
  });

  it('ignores a seam entry point declaration and re-export', () => {
    expect(
      scanSource(
        'completion-records/index.ts',
        `export { discardQueuedCompletionWrites } from './completion-write-hook';
         export function clearAttempt() {}`,
        SEAM_ENTRY_POINTS
      )
    ).toEqual(new Set());
  });
});
