import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { getAllFileImports, isTestFile, resolveImportToFileNode } from './import-graph';

/**
 * Walk backwards from the shared Coda gate so a new authoring or runtime
 * consumer cannot be missed just because it lives in a different component.
 */

const CODA_GATE_MODULE = 'integrations/coda/useCodaAvailability.hook.ts';
const AUTHORING_ROOT = 'components/block-editor/';
const RUNTIME_ROOT = 'components/interactive-tutorial/';
// Navigation is optional UI, not an authored step: it hides on unavailable Coda
// rather than surfacing a guide failure. WorkspaceLink.test.tsx covers the gate.
const NAVIGATION_SURFACE = 'integrations/coda/WorkspaceLink.tsx';
// Availability probes used only by settings/bootstrap are intentionally not
// surfaces; these are the gate decisions that can make an authored block run.
const CAPABILITY_CALL =
  /\b(?:useCodaTerminalGate|useCodaBlockTypesAvailable|codaUnavailableMessage|codaConfigGateMessage|loadCodaCapabilities)\s*\(/;

/**
 * The editor deliberately keeps this option selectable for cross-stack
 * authoring. The runtime challenge guard is the safety half of the contract.
 */
const KNOWN_EDITOR_UNBLOCKED: Readonly<Record<string, string>> = {
  'components/block-editor/forms/ChallengeBlockForm.tsx':
    'Coda mode is retained for authors targeting another stack; ChallengeBlock must fail visibly at runtime.',
};

interface CapabilityConsumer {
  relPath: string;
  source: string;
}

interface CallSite {
  resultName: string | null;
  scope: string;
}

function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function callSites(source: string, callee: string): CallSite[] {
  const sourceFile = ts.createSourceFile(
    'capability-consumer.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const sites: CallSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) {
      let current: ts.Node | undefined = node.parent;
      let resultName: string | null = null;
      let scope: ts.Node | undefined;
      while (current) {
        if (!resultName && ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
          resultName = current.name.text;
        }
        if (isFunctionScope(current)) {
          scope = current;
          break;
        }
        current = current.parent;
      }
      if (!scope) {
        throw new Error(`${callee} call has no function scope`);
      }
      sites.push({ resultName, scope: scope.getText(sourceFile) });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sites;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capabilityConsumers(): CapabilityConsumer[] {
  const records = getAllFileImports().filter(({ file }) => !isTestFile(file));
  const reverseEdges = new Map<string, Set<string>>();

  for (const record of records) {
    for (const specifier of record.imports) {
      const target = resolveImportToFileNode(path.dirname(record.file), specifier);
      if (!target) {
        continue;
      }
      const importers = reverseEdges.get(target) ?? new Set<string>();
      importers.add(record.relPath);
      reverseEdges.set(target, importers);
    }
  }

  const reached = new Set<string>([CODA_GATE_MODULE]);
  const pending = [CODA_GATE_MODULE];
  while (pending.length > 0) {
    const imported = pending.shift()!;
    for (const importer of reverseEdges.get(imported) ?? []) {
      if (!reached.has(importer)) {
        reached.add(importer);
        pending.push(importer);
      }
    }
  }

  return records
    .filter(({ relPath, file }) => reached.has(relPath) && relPath !== CODA_GATE_MODULE && !isTestFile(file))
    .map(({ relPath, file }) => ({ relPath, source: fs.readFileSync(file, 'utf8') }))
    .filter(({ source }) => CAPABILITY_CALL.test(source))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function isAuthoringConsumer(consumer: CapabilityConsumer): boolean {
  return consumer.relPath.startsWith(AUTHORING_ROOT);
}

function isAuthoringSelection(consumer: CapabilityConsumer): boolean {
  return (
    isAuthoringConsumer(consumer) &&
    (consumer.source.includes('MODE_OPTIONS') || consumer.source.includes('CODA_BLOCK_TYPES'))
  );
}

function isRuntimeConsumer(consumer: CapabilityConsumer): boolean {
  return consumer.relPath.startsWith(RUNTIME_ROOT);
}

function editorBlocksSelection(source: string): boolean {
  const directGate = callSites(source, 'useCodaTerminalGate').some(({ scope }) =>
    /return\s+useCodaTerminalGate\(\)\s*===\s*['"]configured['"]/.test(scope)
  );
  if (directGate) {
    return true;
  }

  return callSites(source, 'useCodaBlockTypesAvailable').some(({ resultName, scope }) => {
    if (!resultName) {
      return false;
    }
    const result = escapeRegExp(resultName);
    const conditionalExclusion = new RegExp(`\\b${result}\\b\\s*\\?[\\s\\S]*?:[\\s\\S]*?CODA_BLOCK_TYPES`).test(scope);
    const guardedFallback =
      new RegExp(`if\\s*\\(\\s*${result}\\s*\\)`).test(scope) &&
      /return\s+conversions\.filter\([\s\S]*?CODA_BLOCK_TYPES\.includes\(type\)/.test(scope);
    return conditionalExclusion || guardedFallback;
  });
}

function runtimeSurfacesFailure(source: string): boolean {
  const sites = callSites(source, 'codaUnavailableMessage');
  return (
    sites.length > 0 &&
    sites.every(({ resultName, scope }) => {
      if (!resultName) {
        return false;
      }
      const result = escapeRegExp(resultName);
      const failsVisible = new RegExp(
        `if\\s*\\(\\s*${result}\\s*\\)\\s*\\{[\\s\\S]*?setErrorDetail\\(\\s*${result}\\s*\\)[\\s\\S]*?setState\\(\\s*['"]setup-failed['"]\\s*\\)`
      ).test(scope);
      const rendersVisible =
        new RegExp(`\\{\\s*${result}\\s*\\}`).test(scope) &&
        new RegExp(`(?:!\\s*${result}|${result}\\s*&&|&&\\s*${result})`).test(scope);
      return failsVisible || rendersVisible;
    })
  );
}

function authoringHelperUsesGate(source: string): boolean {
  return callSites(source, 'useCodaTerminalGate').some(({ resultName, scope }) => {
    if (!resultName) {
      return false;
    }
    return new RegExp(`\\b${escapeRegExp(resultName)}\\b\\s*!==\\s*['"]disabled['"]`).test(scope);
  });
}

describe('Coda capability-gated authoring contract', () => {
  const consumers = capabilityConsumers();
  const selections = consumers.filter(isAuthoringSelection);
  const authoringSupport = consumers.filter(
    (consumer) => isAuthoringConsumer(consumer) && !isAuthoringSelection(consumer)
  );
  const runtime = consumers.filter(isRuntimeConsumer);

  it('derives capability consumers through the production import graph', () => {
    expect(consumers.length).toBeGreaterThan(0);
    expect(selections.length).toBeGreaterThan(0);
    expect(runtime.length).toBeGreaterThan(0);
    expect(
      consumers.filter(
        (consumer) =>
          !isAuthoringConsumer(consumer) && !isRuntimeConsumer(consumer) && consumer.relPath !== NAVIGATION_SURFACE
      )
    ).toEqual([]);
    expect(consumers.some(({ relPath }) => relPath === NAVIGATION_SURFACE)).toBe(true);
  });

  it('keeps every authoring selection blocked or explicitly accounted for', () => {
    const unblocked = selections
      .filter((consumer) => !editorBlocksSelection(consumer.source))
      .map(({ relPath }) => relPath);
    expect(unblocked).toEqual(Object.keys(KNOWN_EDITOR_UNBLOCKED).sort());

    for (const [relPath, reason] of Object.entries(KNOWN_EDITOR_UNBLOCKED)) {
      expect(reason.trim()).not.toBe('');
      expect(selections.some((consumer) => consumer.relPath === relPath)).toBe(true);
    }
  });

  it('keeps capability-aware authoring helpers explicit', () => {
    const unguarded = authoringSupport
      .filter((consumer) => !authoringHelperUsesGate(consumer.source))
      .map(({ relPath }) => relPath);
    expect(unguarded).toEqual([]);
  });

  it('requires every runtime consumer to surface an unavailable state', () => {
    const unguarded = runtime
      .filter((consumer) => !runtimeSurfacesFailure(consumer.source))
      .map(({ relPath }) => relPath);
    expect(unguarded).toEqual([]);
  });

  it('does not accept editor evidence from a sibling function', () => {
    const source = `
      function Palette() {
        const available = useCodaBlockTypesAvailable();
        return available ? allTypes : allTypes;
      }
      function oldGuard() {
        return CODA_BLOCK_TYPES.includes(type) ? effectiveExcludeTypes : allTypes;
      }
    `;

    expect(editorBlocksSelection(source)).toBe(false);
  });

  it('does not accept a visible failure wired to another result', () => {
    const source = `
      function Runtime() {
        const unavailable = codaUnavailableMessage(gate, eligibility, wired, subject);
        if (sandboxUnavailable) {
          setErrorDetail(sandboxUnavailable);
          setState('setup-failed');
        }
        return <div>{sandboxUnavailable}</div>;
      }
    `;

    expect(runtimeSurfacesFailure(source)).toBe(false);
  });

  it('binds authoring helper evidence to the gate call result', () => {
    const source = `
      function useOptions() {
        const terminalGate = useCodaTerminalGate();
        const enabled = wanted && delegate !== 'disabled';
        return { enabled, terminalGate };
      }
    `;

    expect(authoringHelperUsesGate(source)).toBe(false);
  });
});
