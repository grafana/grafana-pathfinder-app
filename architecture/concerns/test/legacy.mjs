import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPOSITORY_ROOT } from './helpers.mjs';

export const LEGACY_EXTRACTOR = '.cursor/skills/review/scripts/concern-context.mjs';
export const LEGACY_GATE = '.cursor/skills/review/scripts/contract-evolution-gate.mjs';

// The subproject may not import a harness directory, so every legacy comparison
// runs the Markdown-era script as a child process. That also makes the parity
// claim one about the interface consumers actually call. The script is resolved
// absolutely because the gate tests run it against a throwaway repository.
export function runLegacy(script, args, options = {}) {
  const result = spawnSync(process.execPath, [join(REPOSITORY_ROOT, script), ...args], {
    encoding: 'utf8',
    cwd: options.cwd ?? REPOSITORY_ROOT,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function legacyJson(script, args, options) {
  const result = runLegacy(script, args, options);
  return { ...result, payload: result.code === 0 ? JSON.parse(result.stdout) : null };
}

export function legacyPacket(id) {
  return legacyJson(LEGACY_EXTRACTOR, [id]).payload;
}

export function legacyWorkerPacket(id) {
  return legacyJson(LEGACY_EXTRACTOR, ['--worker', id]).payload;
}

// registry-table.mjs strips one leading and one trailing backtick, independently
// of whether the value was fully quoted. Reproducing it exactly is what lets the
// parity tests assert equality instead of similarity.
export function legacyUnquote(value) {
  return String(value ?? '').replace(/^`|`$/g, '');
}

function legacyList(values) {
  return values.map(legacyUnquote);
}

function legacyRelated(related) {
  return related.kind === 'all_other_concerns' ? ['all¹'] : related.ids;
}

function legacyAnchor(anchor, statements) {
  return anchor === null ? null : { evidence: anchor.evidence, contract: statements.join('<br>') };
}

// The registry keeps a contract as one statement per sentence; the Markdown cell
// joined them with a literal <br>.
function anchorStatements(concern) {
  const record = concern.contract_records.find((entry) => entry.kind === 'established');
  return record ? record.statements : [];
}

export function projectPacketToLegacy(showFull, registryConcern) {
  return {
    id: showFull.id,
    category: showFull.category,
    activation: {
      mode: showFull.activation.mode,
      min_signals: showFull.activation.min_signals,
      max_context_files: showFull.activation.max_context_files,
    },
    trigger_paths: legacyList(showFull.trigger_paths),
    trigger_keywords: legacyList(showFull.trigger_keywords),
    purpose: showFull.purpose,
    load_docs: legacyList(showFull.load_docs),
    load_code: legacyList(showFull.load_code),
    review_questions: legacyList(showFull.review_questions),
    one_way_doors: legacyList(showFull.one_way_doors),
    verification: legacyList(showFull.verification),
    related: legacyRelated(showFull.related),
    contract_anchor: legacyAnchor(showFull.contract_anchor, anchorStatements(registryConcern)),
    named_invariants: showFull.named_invariants.map(({ name, invariant }) => ({ name, invariant })),
    pre_contract_candidate: showFull.pre_contract_candidate,
  };
}

export function projectWorkerPacketToLegacy(showWorker, registryConcern) {
  return {
    id: showWorker.id,
    purpose: showWorker.purpose,
    review_questions: legacyList(showWorker.review_questions),
    one_way_doors: legacyList(showWorker.one_way_doors),
    verification: legacyList(showWorker.verification),
    contract_anchor: legacyAnchor(showWorker.contract_anchor, anchorStatements(registryConcern)),
    named_invariants: showWorker.named_invariants.map(({ name, invariant }) => ({ name, invariant })),
  };
}
