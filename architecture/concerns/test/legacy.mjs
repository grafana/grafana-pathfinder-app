import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPOSITORY_ROOT } from './helpers.mjs';

export const LEGACY_EXTRACTOR = '.cursor/skills/review/scripts/concern-context.mjs';
export const LEGACY_GATE = '.cursor/skills/review/scripts/contract-evolution-gate.mjs';
export const LEGACY_REVIEW_POLICY = '.cursor/skills/review/scripts/review-policy.mjs';

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

// A Markdown table cell cannot hold a newline, so the legacy contract cell joined
// its statements with a literal <br>. The CLI joins them with a space, so
// collapsing the separator on the legacy side is what lets the CLI's own contract
// string be the value under comparison instead of one re-derived from the registry.
export function legacyAnchorSeparator(anchor) {
  return anchor === null ? null : { ...anchor, contract: anchor.contract.split('<br>').join(' ') };
}

function replayAnchorSeparator(packet) {
  return packet === null ? packet : { ...packet, contract_anchor: legacyAnchorSeparator(packet.contract_anchor) };
}

export function rawLegacyPacket(id) {
  return legacyJson(LEGACY_EXTRACTOR, [id]).payload;
}

export function legacyPacket(id) {
  return replayAnchorSeparator(rawLegacyPacket(id));
}

export function legacyWorkerPacket(id) {
  return replayAnchorSeparator(legacyJson(LEGACY_EXTRACTOR, ['--worker', id]).payload);
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

export function projectPacketToLegacy(showFull) {
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
    contract_anchor: showFull.contract_anchor,
    named_invariants: showFull.named_invariants.map(({ name, invariant }) => ({ name, invariant })),
    pre_contract_candidate: showFull.pre_contract_candidate,
  };
}

export function projectWorkerPacketToLegacy(showWorker) {
  return {
    id: showWorker.id,
    purpose: showWorker.purpose,
    review_questions: legacyList(showWorker.review_questions),
    one_way_doors: legacyList(showWorker.one_way_doors),
    verification: legacyList(showWorker.verification),
    contract_anchor: showWorker.contract_anchor,
    named_invariants: showWorker.named_invariants.map(({ name, invariant }) => ({ name, invariant })),
  };
}
