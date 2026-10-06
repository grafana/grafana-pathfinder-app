import { createHash } from 'node:crypto';

import { validateObservation } from '../review-policy.mjs';

export const CONTROLLER_VERSION = '0.1.0';
export const SESSION_SCHEMA_VERSION = 1;

export const CHANGE_CLASSES = [
  'product-runtime',
  'contracts-and-schemas',
  'infra-build-ci',
  'tests-only',
  'docs-only',
  'mixed',
];
export const CHECK_NAMES = ['unit_tests', 'typecheck', 'lint'];
export const SKIP_STAGES = [
  'workers',
  'skeptic_batches',
  'observations',
  'security_specialist',
  'unit_tests',
  'typecheck',
  'lint',
  'test_efficacy',
];
export const COMMAND_EXECUTABLES = new Set(['npm', 'npx', 'node', 'go', 'mage']);

export const ROLES = {
  prior_check: { executor: 'root' },
  route: { executor: 'root' },
  contract_scan: { executor: 'root' },
  evidence_plan: { executor: 'root' },
  observer: { executor: 'agent' },
  security_specialist: { executor: 'agent' },
  contract_specialist: { executor: 'agent' },
  root_overflow: { executor: 'root' },
  check_resolution: { executor: 'root' },
  synthesis: { executor: 'root' },
  skeptic: { executor: 'agent' },
  command: { executor: 'controller' },
};

export const OBSERVER_ROLES = new Set(['observer', 'security_specialist', 'contract_specialist']);
const PRODUCER_ROLES = new Set([...OBSERVER_ROLES, 'root_overflow', 'prior_check', 'check_resolution']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const CONCERN_PATTERN = /^[a-z0-9-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_TEXT = 2000;
const TEST_INPUT = /(?:^|\/)(?:__tests__|__fixtures__|testdata|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.go$/;

export function sha256(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, label, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function textArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array of strings`);
  }
  return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function onlyFields(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    fail(`${label} has unknown field ${unknown}`);
  }
}

export function validateRepoPath(path, label) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.startsWith('-') ||
    path.split('/').includes('..') ||
    /[\0\n\r]/.test(path)
  ) {
    fail(`${label} must be a repository-relative path without .. segments`);
  }
  return path;
}

export function validateArgv(argv, label) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 64) {
    fail(`${label} must be a non-empty argument array of at most 64 entries`);
  }
  for (const [index, arg] of argv.entries()) {
    if (typeof arg !== 'string' || arg.length === 0 || arg.length > 1024 || arg.includes('\0')) {
      fail(`${label}[${index}] must be a non-empty string without NUL bytes`);
    }
  }
  if (!COMMAND_EXECUTABLES.has(argv[0])) {
    fail(`${label}[0] must be one of ${[...COMMAND_EXECUTABLES].join(', ')}; the controller runs no shell`);
  }
  return [...argv];
}

function validateContext(context, label) {
  if (!Array.isArray(context)) {
    fail(`${label} must be an array of { path, excerpt }`);
  }
  return context.map((entry, index) => {
    if (!isObject(entry) || typeof entry.excerpt !== 'string') {
      fail(`${label}[${index}] must be { path, excerpt }`);
    }
    return { path: validateRepoPath(entry.path, `${label}[${index}].path`), excerpt: entry.excerpt };
  });
}

function validateObservations(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${label} must be an array of canonical observations`);
  }
  return value.map((observation, index) => {
    try {
      return validateObservation(observation);
    } catch (error) {
      fail(`${label}[${index}]: ${error.message}`);
    }
  });
}

function validateNoFindings(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    if (
      !isObject(entry) ||
      !CONCERN_PATTERN.test(entry.concern_id ?? '') ||
      entry.status !== 'no_findings' ||
      !['reviewed_clean', 'not_applicable'].includes(entry.reason)
    ) {
      fail(
        `${label}[${index}] must be { concern_id, status: "no_findings", reason: "reviewed_clean" | "not_applicable" }`
      );
    }
    return { concern_id: entry.concern_id, status: 'no_findings', reason: entry.reason };
  });
}

function validateProbes(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 8) {
    fail(`${label} must be an array of at most 8 probes`);
  }
  const seen = new Set();
  return value.map((probe, index) => {
    const at = `${label}[${index}]`;
    if (!isObject(probe)) {
      fail(`${at} must be an object`);
    }
    onlyFields(probe, ['probe_id', 'claim', 'argv', 'expect', 'finding_ids'], at);
    if (!ID_PATTERN.test(probe.probe_id ?? '') || seen.has(probe.probe_id)) {
      fail(`${at}.probe_id must be a unique stable identifier`);
    }
    seen.add(probe.probe_id);
    if (!['exit_zero', 'exit_nonzero'].includes(probe.expect)) {
      fail(`${at}.expect must be exit_zero or exit_nonzero`);
    }
    return {
      probe_id: probe.probe_id,
      claim: text(probe.claim, `${at}.claim`, 300),
      argv: validateArgv(probe.argv, `${at}.argv`),
      expect: probe.expect,
      finding_ids: textArray(probe.finding_ids ?? [], `${at}.finding_ids`),
    };
  });
}

function validateProducerResult(task, result) {
  onlyFields(result, ['observations', 'no_findings', 'contract_packets', 'probes', 'packet'], `${task.role} result`);
  const observations = validateObservations(result.observations, 'observations');
  const noFindings = validateNoFindings(result.no_findings, 'no_findings');
  const probes = validateProbes(result.probes, 'probes');
  const packets = result.contract_packets ?? [];
  if (!Array.isArray(packets)) {
    fail('contract_packets must be an array');
  }
  const owned = new Set(task.concern_ids);
  for (const observation of observations) {
    const contractOwned = owned.has(`contract-evolution:${observation.concern_id}`);
    if (!owned.has(observation.concern_id) && !contractOwned) {
      fail(
        `observation ${observation.finding_id} names concern ${observation.concern_id}, which this task does not own`
      );
    }
  }
  const accounted = new Set([
    ...observations.map(({ concern_id }) => concern_id),
    ...noFindings.map(({ concern_id }) => concern_id),
  ]);
  for (const packet of packets) {
    if (!isObject(packet) || !owned.has(`contract-evolution:${packet.concern_id}`)) {
      fail(`contract packet for ${packet?.concern_id} is not owned by this task`);
    }
    accounted.add(`contract-evolution:${packet.concern_id}`);
  }
  if (task.role === 'contract_specialist') {
    if (!isObject(result.packet)) {
      fail('contract_specialist result must include packet');
    }
    accounted.add(`contract-evolution:${result.packet.concern_id}`);
  } else if (result.packet !== undefined) {
    fail(`${task.role} result must not include packet`);
  }
  const missing = task.concern_ids.filter((id) => !accounted.has(id));
  if (missing.length > 0) {
    fail(
      `result does not account for ${missing.join(', ')}. Return an observation or a no_findings entry for every owned concern`
    );
  }
  return { observations, no_findings: noFindings, contract_packets: packets, probes, packet: result.packet };
}

function validatePriorCheck(task, result) {
  onlyFields(result, ['items', 'cleared', 'observations'], 'prior_check result');
  const expected = task.spec.items;
  if (!Array.isArray(result.items)) {
    fail('items must be an array');
  }
  const items = result.items.map((item, index) => {
    const at = `items[${index}]`;
    if (!isObject(item) || !['fixed', 'unresolved'].includes(item.status)) {
      fail(`${at} must state status fixed or unresolved`);
    }
    return {
      id: item.id,
      concern_id: item.concern_id,
      kind: item.kind,
      status: item.status,
      evidence: textArray(item.evidence, `${at}.evidence`, { allowEmpty: false }),
    };
  });
  const key = ({ id, kind }) => `${kind}:${id}`;
  const got = new Map(items.map((item) => [key(item), item]));
  if (got.size !== items.length) {
    fail('items must list each prior entry once');
  }
  for (const entry of expected) {
    const item = got.get(key(entry));
    if (!item || item.concern_id !== entry.concern_id) {
      fail(`items must check prior ${entry.kind} ${entry.id} (${entry.concern_id}) at the current head`);
    }
  }
  if (items.length !== expected.length) {
    fail('items must list only the prior blocking and deferred entries');
  }
  const observations = validateObservations(result.observations, 'observations');
  for (const item of items.filter(({ kind, status }) => kind === 'blocking' && status === 'unresolved')) {
    if (!observations.some((o) => o.finding_id === item.id && o.concern_id === item.concern_id)) {
      fail(`unresolved prior blocker ${item.id} must be restated as a canonical observation at the current head`);
    }
  }
  const fixed = new Set(items.filter(({ status }) => status === 'fixed').map(({ id }) => id));
  const cleared = (result.cleared ?? []).map((entry, index) => {
    if (!isObject(entry) || !fixed.has(entry.for_id)) {
      fail(`cleared[${index}].for_id must name a prior entry this check verified fixed at the current head`);
    }
    return { for_id: entry.for_id, concern_id: entry.concern_id, claim: entry.claim, reason: entry.reason };
  });
  return { items, cleared, observations };
}

function validateRoute(task, result) {
  onlyFields(result, ['change_class', 'concerns', 'file_coverage', 'concern_gaps'], 'route result');
  if (!CHANGE_CLASSES.includes(result.change_class)) {
    fail(`change_class must be one of ${CHANGE_CLASSES.join(', ')}`);
  }
  const { registry, always_on, changed_files, mode, required_concerns } = task.spec;
  if (!Array.isArray(result.concerns) || result.concerns.length === 0) {
    fail('concerns must be a non-empty array');
  }
  const concerns = result.concerns.map((concern, index) => {
    const at = `concerns[${index}]`;
    if (!isObject(concern) || !registry.includes(concern.id)) {
      fail(`${at}.id must be a concern in docs/design/CONCERNS.md`);
    }
    onlyFields(concern, ['id', 'context'], at);
    return { id: concern.id, context: validateContext(concern.context ?? [], `${at}.context`) };
  });
  const routed = new Set(concerns.map(({ id }) => id));
  if (routed.size !== concerns.length) {
    fail('each routed concern must appear once');
  }
  const gaps = (result.concern_gaps ?? []).map((gap, index) => ({
    id: gap.id,
    reason: text(gap.reason, `concern_gaps[${index}].reason`, 300),
  }));
  for (const id of always_on) {
    if (routed.has(id)) {
      continue;
    }
    if (mode === 'full') {
      fail(`always-on concern ${id} must be routed in a full review`);
    }
    if (!gaps.some((gap) => gap.id === id)) {
      fail(`always-on concern ${id} must be routed or carry an explicit concern_gaps entry`);
    }
  }
  for (const id of required_concerns) {
    if (!routed.has(id)) {
      fail(`concern ${id} is required (${task.spec.required_reasons[id]}) and must be routed`);
    }
  }
  if (!Array.isArray(result.file_coverage)) {
    fail('file_coverage must be an array');
  }
  const coverage = new Map();
  for (const [index, entry] of result.file_coverage.entries()) {
    const at = `file_coverage[${index}]`;
    if (!isObject(entry) || !changed_files.includes(entry.path)) {
      fail(`${at}.path must be a changed file in the review range`);
    }
    if (coverage.has(entry.path)) {
      fail(`${at}.path ${entry.path} must appear once`);
    }
    if (entry.gap !== undefined) {
      coverage.set(entry.path, { path: entry.path, gap: text(entry.gap, `${at}.gap`, 300) });
      continue;
    }
    const ids = textArray(entry.concern_ids, `${at}.concern_ids`, { allowEmpty: false });
    const unrouted = ids.find((id) => !routed.has(id));
    if (unrouted !== undefined) {
      fail(`${at} maps ${entry.path} to ${unrouted}, which is not routed`);
    }
    coverage.set(entry.path, { path: entry.path, concern_ids: ids, reason: text(entry.reason, `${at}.reason`, 300) });
  }
  const unaccounted = changed_files.filter((path) => !coverage.has(path));
  if (unaccounted.length > 0) {
    fail(
      `file_coverage does not account for ${unaccounted.length} changed file(s): ${unaccounted.slice(0, 10).join(', ')}. Map each to routed concerns or record an explicit gap`
    );
  }
  return { change_class: result.change_class, concerns, file_coverage: [...coverage.values()], concern_gaps: gaps };
}

function validateContractScan(task, result) {
  onlyFields(result, ['gates'], 'contract_scan result');
  if (!Array.isArray(result.gates)) {
    fail('gates must be an array');
  }
  const byId = new Map();
  for (const [index, gate] of result.gates.entries()) {
    const at = `gates[${index}]`;
    if (!isObject(gate) || !task.spec.concerns.some(({ concern_id }) => concern_id === gate.concern_id)) {
      fail(`${at}.concern_id must be one of the scanned concerns`);
    }
    if (typeof gate.touches_anchor_with_consumers !== 'boolean') {
      fail(`${at}.touches_anchor_with_consumers must be a boolean`);
    }
    const consumers = textArray(gate.consumers ?? [], `${at}.consumers`);
    const anchorEvidence = textArray(gate.anchor_evidence ?? [], `${at}.anchor_evidence`);
    if (gate.touches_anchor_with_consumers && (consumers.length < 2 || anchorEvidence.length === 0)) {
      fail(`${at} claims an anchor reaching consumers; cite the anchor evidence and at least two current consumers`);
    }
    const spec = task.spec.concerns.find(({ concern_id }) => concern_id === gate.concern_id);
    if (gate.touches_anchor_with_consumers && !spec.has_anchor) {
      fail(`${at}: ${gate.concern_id} has no named contract anchor in docs/design/CONCERN_DETAILS.md`);
    }
    byId.set(gate.concern_id, {
      concern_id: gate.concern_id,
      touches_anchor_with_consumers: gate.touches_anchor_with_consumers,
      consumers,
      anchor_evidence: anchorEvidence,
      context: validateContext(gate.context ?? [], `${at}.context`),
    });
  }
  const missing = task.spec.concerns.filter(({ concern_id }) => !byId.has(concern_id));
  if (missing.length > 0) {
    fail(`gates must account for ${missing.map(({ concern_id }) => concern_id).join(', ')}`);
  }
  return { gates: [...byId.values()] };
}

function requiredCheckNames(changeClass) {
  return changeClass === 'docs-only' ? ['lint'] : CHECK_NAMES;
}

function validateEvidencePlan(task, result) {
  onlyFields(result, ['checks', 'efficacy'], 'evidence_plan result');
  if (!Array.isArray(result.checks) || !Array.isArray(result.efficacy)) {
    fail('checks and efficacy must be arrays');
  }
  const names = new Set();
  const checks = result.checks.map((check, index) => {
    const at = `checks[${index}]`;
    if (!isObject(check) || !CHECK_NAMES.includes(check.name) || names.has(check.name)) {
      fail(`${at}.name must be a unique one of ${CHECK_NAMES.join(', ')}`);
    }
    names.add(check.name);
    if (check.status === 'not_applicable') {
      return { name: check.name, status: 'not_applicable', reason: text(check.reason, `${at}.reason`, 300) };
    }
    if (check.argv !== undefined && check.runs !== undefined) {
      fail(`${at} takes argv or runs, not both`);
    }
    const runs = check.runs ?? [check.argv];
    if (!Array.isArray(runs) || runs.length === 0 || runs.length > 4) {
      fail(`${at}.runs must hold one to four argument arrays`);
    }
    return { name: check.name, runs: runs.map((argv, run) => validateArgv(argv, `${at}.runs[${run}]`)) };
  });
  const missing = requiredCheckNames(task.spec.change_class).filter((name) => !names.has(name));
  if (missing.length > 0) {
    fail(`checks must include ${missing.join(', ')}, as argv or not_applicable with a reason`);
  }
  const behaviors = new Set();
  const efficacy = result.efficacy.map((entry, index) => {
    const at = `efficacy[${index}]`;
    if (!isObject(entry)) {
      fail(`${at} must be an object`);
    }
    const behavior = text(entry.behavior, `${at}.behavior`, 300);
    if (behaviors.has(behavior)) {
      fail(`${at}.behavior must be unique`);
    }
    behaviors.add(behavior);
    if (entry.result === 'no_test_exists') {
      return { behavior, result: 'no_test_exists', reason: text(entry.reason, `${at}.reason`, 300) };
    }
    const revertPaths = textArray(entry.revert_paths, `${at}.revert_paths`, { allowEmpty: false }).map((path) => {
      validateRepoPath(path, `${at}.revert_paths`);
      if (!task.spec.changed_files.includes(path)) {
        fail(`${at}.revert_paths entry ${path} is not a changed file`);
      }
      return path;
    });
    return {
      behavior,
      test: text(entry.test, `${at}.test`, 300),
      argv: validateArgv(entry.argv, `${at}.argv`),
      revert_paths: revertPaths,
    };
  });
  return { checks, efficacy };
}

function validateCheckResolution(task, result) {
  onlyFields(
    result,
    ['resolution', 'observation', 'reason', 'signature', 'preserve_paths', 'preserve_reason'],
    'check_resolution result'
  );
  const allowed = task.spec.allowed;
  if (!allowed.includes(result.resolution)) {
    fail(`resolution must be one of ${allowed.join(', ')}`);
  }
  if (result.resolution === 'observation') {
    const [observation] = validateObservations([result.observation], 'observation');
    return { resolution: 'observation', observation, observations: [observation] };
  }
  if (result.resolution === 'baseline_failure') {
    const signature = text(result.signature, 'signature', 200);
    if (signature.length < 8) {
      fail('signature must be at least 8 characters of the failure output, such as a failing test name or error line');
    }
    const preserve = (result.preserve_paths ?? []).map((path) => {
      validateRepoPath(path, 'preserve_paths');
      if (!task.spec.changed_files.includes(path)) {
        fail(`preserve_paths entry ${path} is not a changed file`);
      }
      if (!TEST_INPUT.test(path)) {
        fail(`preserve_paths entry ${path} is not a test file or fixture; the baseline keeps the base implementation`);
      }
      return path;
    });
    return {
      resolution: 'baseline_failure',
      reason: text(result.reason, 'reason', 300),
      signature,
      preserve_paths: preserve,
      preserve_reason: preserve.length > 0 ? text(result.preserve_reason, 'preserve_reason', 300) : null,
      observations: [],
    };
  }
  return { resolution: result.resolution, reason: text(result.reason, 'reason', 300), observations: [] };
}

function validateSynthesis(task, result) {
  onlyFields(result, ['merges', 'revisions', 'additions', 'notes'], 'synthesis result');
  const refs = new Set(task.spec.refs);
  const merges = (result.merges ?? []).map((merge, index) => {
    const at = `merges[${index}]`;
    if (!isObject(merge) || !refs.has(merge.ref) || !refs.has(merge.into) || merge.ref === merge.into) {
      fail(`${at} must merge one observation ref into a different existing ref`);
    }
    return { ref: merge.ref, into: merge.into, reason: text(merge.reason, `${at}.reason`, 300) };
  });
  const merged = new Set(merges.map(({ ref }) => ref));
  if (merged.size !== merges.length) {
    fail('each ref may be merged once');
  }
  if (merges.some(({ into }) => merged.has(into))) {
    fail('merge targets must themselves be kept');
  }
  const revisions = (result.revisions ?? []).map((revision, index) => {
    const at = `revisions[${index}]`;
    if (!isObject(revision) || !refs.has(revision.ref) || merged.has(revision.ref)) {
      fail(`${at}.ref must name a kept observation ref`);
    }
    const [observation] = validateObservations([revision.observation], `${at}.observation`);
    return { ref: revision.ref, observation, reason: text(revision.reason, `${at}.reason`, 300) };
  });
  if (new Set(revisions.map(({ ref }) => ref)).size !== revisions.length) {
    fail('each ref may be revised once');
  }
  const additions = validateObservations(result.additions ?? [], 'additions');
  for (const addition of additions) {
    if (!task.spec.routed.includes(addition.concern_id)) {
      fail(`addition ${addition.finding_id} names concern ${addition.concern_id}, which is not routed`);
    }
  }
  return { merges, revisions, additions, notes: result.notes ? text(result.notes, 'notes') : null };
}

function validateSkeptic(task, result) {
  onlyFields(result, ['verdicts'], 'skeptic result');
  if (!Array.isArray(result.verdicts)) {
    fail('verdicts must be an array');
  }
  const ids = new Set(task.spec.finding_ids);
  const seen = new Set();
  const verdicts = result.verdicts.map((entry, index) => {
    const at = `verdicts[${index}]`;
    if (!isObject(entry) || !ids.has(entry.finding_id) || seen.has(entry.finding_id)) {
      fail(`${at}.finding_id must be a unique finding in this batch`);
    }
    seen.add(entry.finding_id);
    if (!['confirmed', 'refuted', 'uncertain'].includes(entry.verdict)) {
      fail(`${at}.verdict must be confirmed, refuted, or uncertain`);
    }
    return { finding_id: entry.finding_id, verdict: entry.verdict, reason: text(entry.reason, `${at}.reason`) };
  });
  if (seen.size !== ids.size) {
    fail(`verdicts must cover every finding in the batch: ${[...ids].join(', ')}`);
  }
  return { verdicts };
}

const VALIDATORS = {
  prior_check: validatePriorCheck,
  route: validateRoute,
  contract_scan: validateContractScan,
  evidence_plan: validateEvidencePlan,
  observer: validateProducerResult,
  security_specialist: validateProducerResult,
  contract_specialist: validateProducerResult,
  root_overflow: validateProducerResult,
  check_resolution: validateCheckResolution,
  synthesis: validateSynthesis,
  skeptic: validateSkeptic,
};

export function validateTaskResult(task, result) {
  const validator = VALIDATORS[task.role];
  if (!validator) {
    fail(`${task.role} results are recorded by the controller, not by record`);
  }
  if (!isObject(result)) {
    fail(`${task.role} result must be a JSON object`);
  }
  return validator(task, result);
}

export function validateReceipt(receipt, task) {
  const executor = ROLES[task.role].executor;
  const agentId = receipt.agent_id ?? null;
  if (agentId !== null && !ID_PATTERN.test(agentId)) {
    fail('agent id must be a host identifier of letters, digits, dots, dashes, and underscores');
  }
  if (executor === 'agent' && agentId === null && receipt.host_capability !== 'no_agent_identity') {
    fail(
      'an agent task needs --agent-id from the host tool result, or --no-agent-identity to record that the host exposed none'
    );
  }
  return {
    host: receipt.host ?? 'unspecified',
    agent_id: agentId,
    provenance: executor === 'root' ? 'root_attested' : agentId === null ? 'unverified_identity' : 'host_reported',
  };
}

export function isProducer(role) {
  return PRODUCER_ROLES.has(role);
}

export function validateIdentity(identity) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repo ?? '')) {
    fail('repo must look like owner/name');
  }
  if (!Number.isInteger(identity.pr) || identity.pr < 1) {
    fail('pr must be a positive integer');
  }
  for (const field of ['base_sha', 'head_sha']) {
    if (!SHA_PATTERN.test(identity[field] ?? '')) {
      fail(`${field} must be a full lowercase commit SHA`);
    }
  }
  if (!ID_PATTERN.test(identity.reviewer ?? '')) {
    fail('reviewer must be a login-like identifier');
  }
  return identity;
}

export function emptyState() {
  return {
    identity: null,
    revision: 0,
    last_hash: null,
    scope: null,
    gates: { security: null, contract: {}, contract_done: false },
    plan: null,
    tasks: {},
    order: [],
    observations: {},
    observation_order: [],
    admitted: null,
    synthesis: null,
    rounds: [],
    verdicts: {},
    policy: null,
    reconciliation: null,
    waivers: {},
    finalized: null,
  };
}

function cloneState(state) {
  return structuredClone(state);
}

const REDUCERS = {
  session_started(state, { identity }) {
    if (state.identity) {
      fail('session already started');
    }
    state.identity = identity;
  },
  scope_recorded(state, data) {
    state.scope = data;
  },
  gate_recorded(state, data) {
    if (data.gate === 'security') {
      state.gates.security = data.result;
    } else {
      state.gates.contract[data.concern_id] = data.outcome;
    }
  },
  contract_gates_completed(state) {
    state.gates.contract_done = true;
  },
  plan_recorded(state, data) {
    state.plan = data;
  },
  task_created(state, { task }) {
    if (state.tasks[task.id]) {
      fail(`task ${task.id} already exists`);
    }
    state.tasks[task.id] = { ...task, status: 'ready', result: null, result_hash: null, receipt: null, history: [] };
    state.order.push(task.id);
  },
  task_completed(state, { task_id, result, result_hash, receipt }) {
    const task = state.tasks[task_id];
    if (!task || task.status !== 'ready') {
      fail(`task ${task_id} is not ready`);
    }
    Object.assign(task, { status: 'completed', result, result_hash, receipt });
  },
  task_revised(state, { task_id, result, result_hash, receipt, reason }) {
    const task = state.tasks[task_id];
    task.history.push({ result_hash: task.result_hash, receipt: task.receipt, replaced_because: reason });
    for (const record of Object.values(state.observations)) {
      if (record.source_task === task_id) {
        record.superseded = true;
      }
    }
    Object.assign(task, { result, result_hash, receipt });
  },
  task_blocked(state, { task_id, reason, receipt }) {
    const task = state.tasks[task_id];
    if (!task || task.status !== 'ready') {
      fail(`task ${task_id} is not ready`);
    }
    Object.assign(task, { status: 'blocked', blocked_reason: reason, receipt });
  },
  observations_recorded(state, { source_task, source_hash, observations }) {
    for (const { ref, observation } of observations) {
      if (state.observations[ref]) {
        fail(`observation ref ${ref} already exists`);
      }
      state.observations[ref] = {
        ref,
        source_task,
        source_hash,
        observation,
        revisions: [],
        merged_into: null,
        superseded: false,
      };
      state.observation_order.push(ref);
    }
  },
  synthesis_applied(state, { admitted, merges, revisions }) {
    for (const { ref, into } of merges) {
      state.observations[ref].merged_into = into;
    }
    for (const { ref, observation, reason } of revisions) {
      const record = state.observations[ref];
      record.revisions.push({ previous: record.observation, reason });
      record.observation = observation;
    }
    state.admitted = admitted;
    state.synthesis = { merges, revisions };
  },
  verification_round_opened(state, { index, task_ids }) {
    state.rounds.push({ index, task_ids, closed: false });
  },
  verification_round_closed(state, { index, appended }) {
    state.rounds[index].closed = true;
    for (const [findingId, verdicts] of Object.entries(appended)) {
      state.verdicts[findingId] = [...(state.verdicts[findingId] ?? []), ...verdicts];
    }
  },
  policy_completed(state, { results }) {
    state.policy = results;
  },
  reconciled(state, data) {
    state.reconciliation = data;
  },
  waiver_recorded(state, waiver) {
    if (state.waivers[waiver.stage]) {
      fail(`stage ${waiver.stage} is already waived`);
    }
    state.waivers[waiver.stage] = waiver;
  },
  finalized(state, data) {
    state.finalized = data;
  },
};

export function eventHash(previousHash, event) {
  const { hash: _ignored, ...body } = event;
  return sha256(`${previousHash ?? ''}\n${canonicalJson(body)}`);
}

export function applyEvent(state, event) {
  const reducer = REDUCERS[event.type];
  if (!reducer) {
    fail(`unknown session event ${event.type}`);
  }
  if (event.seq !== state.revision + 1) {
    fail(`event ${event.seq} is out of order; expected ${state.revision + 1}`);
  }
  if (event.prev_hash !== state.last_hash || event.hash !== eventHash(state.last_hash, event)) {
    fail(`event ${event.seq} breaks the session hash chain`);
  }
  const next = cloneState(state);
  reducer(next, event.data);
  next.revision = event.seq;
  next.last_hash = event.hash;
  return next;
}

export function foldEvents(events) {
  return events.reduce(applyEvent, emptyState());
}

export function sealEvents(state, drafts, now = () => new Date().toISOString()) {
  let previous = state.last_hash;
  let seq = state.revision;
  return drafts.map(({ type, data }) => {
    seq += 1;
    const event = { seq, type, at: now(), prev_hash: previous, data };
    event.hash = eventHash(previous, event);
    previous = event.hash;
    return event;
  });
}

export function makeTask(state, { role, stage, concern_ids = [], prerequisites = [], spec = {}, label }) {
  const index = state.order.length + 1;
  const suffix = label ? `-${label.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}` : '';
  return {
    id: `t${String(index).padStart(3, '0')}-${role.replace(/_/g, '-')}${suffix}`.slice(0, 80),
    role,
    executor: ROLES[role].executor,
    stage,
    head: state.identity.head_sha,
    concern_ids,
    prerequisites,
    spec,
  };
}

export function tasksWhere(state, predicate) {
  return state.order.map((id) => state.tasks[id]).filter(predicate);
}
