import * as fs from 'fs';
import * as path from 'path';

import { getAllFileImports, isTestFile, resolveImportToFileNode } from './import-graph';

/**
 * Walk backwards from the shared Coda gate so a new authoring or runtime
 * consumer cannot be missed just because it lives in a different component.
 */

const CODA_GATE_MODULE = 'integrations/coda/useCodaAvailability.hook.ts';
const AUTHORING_ROOT = 'components/block-editor/';
const RUNTIME_ROOT = 'components/interactive-tutorial/';
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
  return (
    /useCodaTerminalGate\(\)\s*===\s*['"]configured['"]/.test(source) ||
    source.includes('effectiveExcludeTypes') ||
    /CODA_BLOCK_TYPES\.includes\(type\)/.test(source)
  );
}

function runtimeSurfacesFailure(source: string): boolean {
  const sharedGuard = source.includes('codaUnavailableMessage(');
  const visibleState = source.includes('setErrorDetail(unavailable)') || source.includes('{sandboxUnavailable}');
  const failurePath = source.includes('setup-failed') || source.includes('sandboxUnavailable');
  return sharedGuard && visibleState && failurePath;
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
    expect(consumers.filter((consumer) => !isAuthoringConsumer(consumer) && !isRuntimeConsumer(consumer))).toEqual([]);
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
      .filter((consumer) => !/gate\s*!==\s*['"]disabled['"]/.test(consumer.source))
      .map(({ relPath }) => relPath);
    expect(unguarded).toEqual([]);
  });

  it('requires every runtime consumer to surface an unavailable state', () => {
    const unguarded = runtime
      .filter((consumer) => !runtimeSurfacesFailure(consumer.source))
      .map(({ relPath }) => relPath);
    expect(unguarded).toEqual([]);
  });
});
