import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findTable, unquote } from './registry-table.mjs';

const MAX_WORKER_FILES = 8;
const MAX_WORKER_CHARACTERS = 30_000;

function splitList(value, separator = ',') {
  if (!value) {
    return [];
  }
  return value
    .split(separator)
    .map((entry) => unquote(entry.trim()))
    .filter(Boolean);
}

function splitContextList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(';')
    .flatMap((entry) => (entry.includes('`') ? splitList(entry) : [unquote(entry.trim())]))
    .filter(Boolean);
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function registryTables(routingMarkdown, detailMarkdown) {
  return {
    routing: findTable(routingMarkdown, ['id', 'trigger_paths', 'trigger_keywords']),
    details: findTable(detailMarkdown, ['id', 'purpose', 'review_questions', 'one_way_doors']),
    anchors: findTable(detailMarkdown, ['concern', 'anchor', 'contract']),
    invariants: findTable(detailMarkdown, ['name', 'concern', 'invariant']),
    candidates: findTable(detailMarkdown, ['concern', 'evidence', 'proposed owner']),
  };
}

export function extractConcernContext({ routingMarkdown, detailMarkdown, concern }) {
  const tables = registryTables(routingMarkdown, detailMarkdown);
  const routing = tables.routing.find((row) => unquote(row.id) === concern);
  const details = tables.details.find((row) => unquote(row.id) === concern);
  if (!routing || !details) {
    throw new Error(`Concern ${concern} is not present in both registries`);
  }
  const anchor = tables.anchors.find((row) => unquote(row.concern) === concern);
  const candidate = tables.candidates.find((row) => unquote(row.concern) === concern);
  const category = { AO: 'always-on', sub: 'subsystem', xcut: 'cross-cutting' }[routing.cat];

  return {
    id: concern,
    category,
    activation: {
      mode: unquote(routing.mode),
      min_signals: Number(routing.min),
      max_context_files: Number(routing.max),
    },
    trigger_paths: splitList(routing.trigger_paths),
    trigger_keywords: splitList(routing.trigger_keywords),
    purpose: details.purpose,
    load_docs: splitList(details.load_docs),
    load_code: splitContextList(details.load_code),
    review_questions: splitList(details.review_questions, ';'),
    one_way_doors: splitList(details.one_way_doors, ';'),
    verification: splitList(details.verification, ';'),
    related: splitList(details.related),
    contract_anchor: anchor ? { evidence: anchor.anchor, contract: anchor.contract } : null,
    named_invariants: tables.invariants
      .filter((row) => unquote(row.concern) === concern)
      .map((row) => ({ name: unquote(row.name), invariant: row.invariant })),
    pre_contract_candidate: candidate
      ? { evidence: candidate.evidence, proposed_owner: candidate['proposed owner'] }
      : null,
  };
}

function workerConcernContext(context) {
  const { id, purpose, review_questions, one_way_doors, verification, contract_anchor, named_invariants } = context;
  return { id, purpose, review_questions, one_way_doors, verification, contract_anchor, named_invariants };
}

export function validateConcernRegistry({ routingMarkdown, detailMarkdown }) {
  const tables = registryTables(routingMarkdown, detailMarkdown);
  const errors = [];
  const routingIds = tables.routing.map((row) => unquote(row.id));
  const detailIds = tables.details.map((row) => unquote(row.id));
  const known = new Set(routingIds);
  const categoryDefaults = {
    AO: { on: 'Y', mode: 'always' },
    sub: { on: 'N', mode: 'strong' },
    xcut: { on: 'N', mode: 'weak' },
  };

  for (const id of new Set(routingIds)) {
    if (routingIds.filter((candidate) => candidate === id).length > 1) {
      errors.push(`Duplicate routing concern: ${id}`);
    }
  }
  for (const id of new Set(detailIds)) {
    if (detailIds.filter((candidate) => candidate === id).length > 1) {
      errors.push(`Duplicate detail concern: ${id}`);
    }
  }
  for (const id of routingIds) {
    if (!detailIds.includes(id)) {
      errors.push(`Missing detail concern: ${id}`);
    }
  }
  for (const id of detailIds) {
    if (!known.has(id)) {
      errors.push(`Missing routing concern: ${id}`);
    }
  }
  for (const row of tables.routing) {
    const id = unquote(row.id);
    const defaults = categoryDefaults[row.cat];
    if (!defaults) {
      errors.push(`Unknown category ${row.cat} for ${id}`);
    } else {
      if (row.on !== defaults.on) {
        errors.push(`on must be ${defaults.on} for ${id}`);
      }
      if (row.mode !== defaults.mode) {
        errors.push(`mode must be ${defaults.mode} for ${id}`);
      }
    }
    const minSignals = Number(row.min);
    if (!Number.isInteger(minSignals) || minSignals < 1 || minSignals > 8) {
      errors.push(`min_signals must be between 1 and 8 for ${id}`);
    }
    const maxContextFiles = Number(row.max);
    if (!Number.isInteger(maxContextFiles) || maxContextFiles < 1 || maxContextFiles > MAX_WORKER_FILES) {
      errors.push(`max_context_files must be between 1 and ${MAX_WORKER_FILES} for ${id}`);
    }
    if (splitList(row.trigger_paths).length === 0) {
      errors.push(`trigger_paths must not be empty for ${id}`);
    }
    if (row.cat !== 'AO' && splitList(row.trigger_keywords).length === 0) {
      errors.push(`trigger_keywords must not be empty for ${id}`);
    }
  }
  for (const row of tables.details) {
    const id = unquote(row.id);
    for (const field of [
      'purpose',
      'load_docs',
      'load_code',
      'review_questions',
      'one_way_doors',
      'verification',
      'related',
    ]) {
      if (!unquote(row[field] ?? '').trim()) {
        errors.push(`Missing ${field} for ${id}`);
      }
    }
    for (const related of splitList(row.related)) {
      if (related !== 'all¹' && !known.has(related)) {
        errors.push(`Unknown related concern ${related} from ${id}`);
      }
    }
  }
  for (const row of [...tables.anchors, ...tables.candidates, ...tables.invariants]) {
    const id = unquote(row.concern);
    if (!known.has(id)) {
      errors.push(`Unknown concern reference: ${id}`);
    }
  }
  for (const id of duplicateValues(tables.anchors.map((row) => unquote(row.concern)))) {
    errors.push(`Duplicate contract anchor: ${id}`);
  }
  for (const id of duplicateValues(tables.candidates.map((row) => unquote(row.concern)))) {
    errors.push(`Duplicate pre-contract candidate: ${id}`);
  }
  for (const name of duplicateValues(tables.invariants.map((row) => unquote(row.name)))) {
    errors.push(`Duplicate named invariant: ${name}`);
  }
  return errors;
}

function normalizeContext(context, concern) {
  if (!Array.isArray(context)) {
    throw new Error(`context must be an array for ${concern}`);
  }
  const byPath = new Map();
  for (const entry of context) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0 || typeof entry.excerpt !== 'string') {
      throw new Error(`each context entry for ${concern} must include path and excerpt`);
    }
    const existing = byPath.get(entry.path);
    if (existing === undefined) {
      byPath.set(entry.path, entry.excerpt);
    } else if (existing !== entry.excerpt) {
      byPath.set(entry.path, `${existing}\n${entry.excerpt}`);
    }
  }
  return [...byPath].map(([path, excerpt]) => ({ path, excerpt }));
}

function mergeContext(left, right) {
  return normalizeContext([...left, ...right], 'worker packet');
}

function contextCharacters(context) {
  return context.reduce((total, entry) => total + entry.path.length + entry.excerpt.length, 0);
}

function fitsWorker(context) {
  return context.length <= MAX_WORKER_FILES && contextCharacters(context) <= MAX_WORKER_CHARACTERS;
}

function sharedFiles(left, right) {
  const paths = new Set(left.map(({ path }) => path));
  return right.filter(({ path }) => paths.has(path)).length;
}

function workerPacket(id, kind, concern) {
  return { id, kind, concern_ids: [concern.id], context: concern.context };
}

function publicWorker(worker) {
  return {
    ...worker,
    files: worker.context.map(({ path }) => path),
    context_characters: contextCharacters(worker.context),
  };
}

function validateGateRanking(gate) {
  const id = gate.concern_id ?? 'unknown';
  if (!/^[a-z0-9-]+$/.test(gate.concern_id ?? '')) {
    throw new Error(`fired contract gate ${id} must state concern_id as lowercase letters, digits, and hyphens`);
  }
  if (typeof gate.touches_anchor_with_consumers !== 'boolean') {
    throw new Error(`fired contract gate ${id} must state touches_anchor_with_consumers as a boolean`);
  }
  if (!Number.isFinite(gate.prior_semantic_pr_count)) {
    throw new Error(`fired contract gate ${id} must state prior_semantic_pr_count as a finite number`);
  }
}

function firedContractGates(contract_evolution) {
  if (!contract_evolution) {
    return [];
  }
  const listed = Array.isArray(contract_evolution);
  const gates = listed ? contract_evolution.filter(Boolean) : [contract_evolution];
  for (const key of duplicateValues(gates.map((gate) => gate.concern_id ?? 'unknown'))) {
    throw new Error(`fired contract gate ${key} must be unique`);
  }
  for (const gate of listed ? gates : []) {
    validateGateRanking(gate);
  }
  return [...gates].sort((left, right) => {
    const leftId = String(left.concern_id ?? 'unknown');
    const rightId = String(right.concern_id ?? 'unknown');
    return (
      Number(right.touches_anchor_with_consumers === true) - Number(left.touches_anchor_with_consumers === true) ||
      (right.prior_semantic_pr_count ?? 0) - (left.prior_semantic_pr_count ?? 0) ||
      (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
    );
  });
}

export function buildReviewPlan({ mode, concerns, contract_evolution = null, skeptic_batch_count = 0 }) {
  if (mode !== 'full' && mode !== 'incremental') {
    throw new Error('mode must be full or incremental');
  }
  if (!Array.isArray(concerns) || !Number.isInteger(skeptic_batch_count) || skeptic_batch_count < 0) {
    throw new Error('concerns must be an array and skeptic_batch_count must be a non-negative integer');
  }
  const normalized = concerns.map((concern) => {
    if (!concern || !/^[a-z0-9-]+$/.test(concern.id ?? '')) {
      throw new Error('each routed concern must include an id');
    }
    return { ...concern, context: normalizeContext(concern.context ?? [], concern.id) };
  });
  const duplicate = normalized.find((concern, index) => normalized.findIndex(({ id }) => id === concern.id) !== index);
  if (duplicate) {
    throw new Error(`routed concern ${duplicate.id} must be unique`);
  }

  const generalLimit = mode === 'full' ? 2 : 1;
  const workers = [];
  const rootConcernIds = [];
  const dispatchOrder = [...normalized].sort(
    (left, right) => Number(right.specialist === 'security') - Number(left.specialist === 'security')
  );
  for (const concern of dispatchOrder) {
    if (!fitsWorker(concern.context)) {
      rootConcernIds.push(concern.id);
      continue;
    }
    const dedicatedSecurity = concern.specialist === 'security';
    const candidates = dedicatedSecurity
      ? []
      : workers
          .filter(({ kind }) => kind === 'general')
          .map((worker) => ({ worker, merged: mergeContext(worker.context, concern.context) }))
          .filter(({ merged }) => fitsWorker(merged))
          .sort(
            (left, right) =>
              sharedFiles(right.worker.context, concern.context) - sharedFiles(left.worker.context, concern.context)
          );
    if (candidates.length > 0) {
      candidates[0].worker.concern_ids.push(concern.id);
      candidates[0].worker.context = candidates[0].merged;
      continue;
    }
    const generalCount = workers.filter(({ kind }) => kind === 'general' || kind === 'security').length;
    if (generalCount < generalLimit) {
      workers.push(
        workerPacket(
          dedicatedSecurity ? 'security' : `general-${generalCount + 1}`,
          dedicatedSecurity ? 'security' : 'general',
          concern
        )
      );
    } else {
      rootConcernIds.push(concern.id);
    }
  }

  const firedGates = firedContractGates(contract_evolution);
  const listedGates = Array.isArray(contract_evolution);
  let specialistTaken = false;
  for (const gate of firedGates) {
    const context = normalizeContext(gate.context ?? [], `contract evolution ${gate.concern_id ?? 'unknown'}`);
    if (
      specialistTaken ||
      !/^[a-z0-9-]+$/.test(gate.concern_id ?? '') ||
      !fitsWorker(context) ||
      (listedGates && context.length === 0)
    ) {
      rootConcernIds.push(`contract-evolution:${gate.concern_id ?? 'unknown'}`);
      continue;
    }
    specialistTaken = true;
    workers.push({
      id: 'contract-evolution',
      kind: 'contract_evolution',
      concern_ids: [gate.concern_id],
      context,
    });
  }

  const publicWorkers = workers.map(publicWorker);
  const totalLimit = mode === 'full' ? 3 : 2;
  if (publicWorkers.length > totalLimit || publicWorkers.some((worker) => !fitsWorker(worker.context))) {
    throw new Error('review plan exceeds its worker or context budget');
  }
  const coverage = Object.fromEntries([
    ...publicWorkers.flatMap((worker) =>
      worker.concern_ids.map((id) => [
        worker.kind === 'contract_evolution' ? `contract-evolution:${id}` : id,
        worker.id,
      ])
    ),
    ...rootConcernIds.map((id) => [id, 'root']),
  ]);
  return {
    mode,
    workers: publicWorkers,
    root: { synthesizes: true, concern_ids: rootConcernIds },
    coverage,
    debug: {
      mode,
      worker_count: publicWorkers.length,
      skeptic_batch_count,
      context_characters: {
        cumulative: publicWorkers.reduce((total, worker) => total + worker.context_characters, 0),
        maximum: Math.max(0, ...publicWorkers.map(({ context_characters }) => context_characters)),
      },
    },
  };
}

function main() {
  if (process.argv[2] === '--plan' && process.argv.length === 4) {
    const input = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(`${JSON.stringify(buildReviewPlan(input), null, 2)}\n`);
    return;
  }
  const workerMode = process.argv[2] === '--worker';
  const concern = workerMode ? process.argv[3] : process.argv[2];
  if (!concern || process.argv.length !== (workerMode ? 4 : 3)) {
    throw new Error('Expected one concern id');
  }
  const routingMarkdown = readFileSync(
    fileURLToPath(new URL('../../../../docs/design/CONCERNS.md', import.meta.url)),
    'utf8'
  );
  const detailMarkdown = readFileSync(
    fileURLToPath(new URL('../../../../docs/design/CONCERN_DETAILS.md', import.meta.url)),
    'utf8'
  );
  const context = extractConcernContext({ routingMarkdown, detailMarkdown, concern });
  process.stdout.write(`${JSON.stringify(workerMode ? workerConcernContext(context) : context, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
