#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateObservation } from './review-policy.mjs';

const VERDICTS = new Set([
  'follows_contract',
  'coherent_extension',
  'contract_missing',
  'contract_branching',
  'insufficient_history',
]);
const ORDINALS = new Set(['first', 'second', 'third_or_later']);
const HISTORY_STATUSES = new Set(['complete', 'partial', 'unavailable']);
const REVERSIBILITY = new Set(['reversible', 'partially_reversible', 'irreversible_without_cleanup', 'unknown']);
const SOURCE_KINDS = new Set(['anchor', 'commit', 'issue', 'pr']);
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

const list = (values) => [...values].map((value) => `\`${value}\``).join(', ');

export const CONTRACT_SOURCE_EXAMPLES = [
  { kind: 'pr', id: 1234, sha: 'abcdef1', selection_reason: 'Introduced the contract this change touches.' },
  { kind: 'anchor', selection_reason: 'The concern contract anchor in docs/design/CONCERN_DETAILS.md.' },
  { kind: 'commit', sha: '1234567890abcdef', selection_reason: 'A later fix to the same owner.' },
  { kind: 'issue', id: 1300, selection_reason: 'A follow-up issue linked from that PR review.' },
];

export const CONTRACT_PACKET_EXAMPLE = {
  concern_id: 'example-concern',
  origin_or_contract_anchor: 'src/example/owner.ts: exampleOwner is the only writer',
  recent_semantic_changes: [{ pr: 1234, sha: 'abcdef1', timestamp: 1700000000, summary: 'Added exampleOwner.' }],
  current_contract_owner: 'none found',
  new_contract_delta: 'A second module now writes the same value.',
  competing_owners_or_representations: ['src/example/other.ts: otherWriter'],
  verdict: 'contract_missing',
  history_status: 'complete',
  use_ordinal: 'first',
  same_bug_count: 0,
  has_recorded_anchor: false,
  anchor_violated: false,
  branching_conditions: [],
  sources: CONTRACT_SOURCE_EXAMPLES.slice(0, 2),
  finding: {
    finding_id: 'example-concern-no-owner',
    title: 'Two modules write the same value with no recorded owner',
    evidence: ['src/example/other.ts:10 writes the value that src/example/owner.ts:5 also writes.'],
    why_it_matters: 'The two writers can drift.',
    suggested_action: 'Name one owner in the concern contract anchor.',
    reversibility: 'reversible',
    applies_to_files: ['src/example/other.ts'],
  },
};

const json = (value) => JSON.stringify(value);

export const CONTRACT_PACKET_SCHEMA = [
  '### Contract evolution packet schema',
  '',
  '`contract-evolution-policy.mjs` checks `packet` against exactly these rules. A rejected packet gets the validator error back word for word.',
  '',
  '- `concern_id`, `origin_or_contract_anchor`, `current_contract_owner`, `new_contract_delta`: non-empty strings. `concern_id` is the gated concern, lowercase letters, digits, and dashes.',
  `- \`verdict\`: one of ${list(VERDICTS)}.`,
  `- \`history_status\`: one of ${list(HISTORY_STATUSES)}.`,
  `- \`use_ordinal\`: one of ${list(ORDINALS)}.`,
  '- `recent_semantic_changes`: array of `{ "pr": <integer>, "sha": "<7 to 40 hex characters>", "timestamp": <integer Unix seconds, as in the gate output>, "summary": "<non-empty string>" }`.',
  '- `competing_owners_or_representations`, `branching_conditions`: arrays.',
  `- \`sources\`: array. Each entry is \`{ "kind": ${[...SOURCE_KINDS].map((kind) => `"${kind}"`).join(' | ')}, "selection_reason": "<non-empty string>" }\`, plus \`"id": <integer>\` when \`kind\` is \`pr\` or \`issue\`, and \`"sha": "<7 to 40 hex characters>"\` when \`kind\` is \`pr\` or \`commit\`. Other shapes, such as \`{ "id", "reason" }\`, are rejected.`,
  '- `has_recorded_anchor`, `anchor_violated`: booleans. `anchor_violated: true` needs `has_recorded_anchor: true`.',
  '- `same_bug_count`: integer, 0 or more.',
  `- \`finding\`: required when the verdict is \`contract_missing\` or \`contract_branching\`, or when \`insufficient_history\` applies (that verdict, or \`history_status\` other than \`complete\` with no recorded anchor; for a clean verdict there the adapter writes a low finding if you omit it). Omit it for a clean verdict with complete history or a recorded anchor. Shape: \`finding_id\` (letters, digits, dots, dashes, underscores; at most 80), \`title\`, \`why_it_matters\`, \`suggested_action\` (non-empty strings), \`evidence\` (non-empty array of non-empty strings), \`applies_to_files\` (array of non-empty strings), \`reversibility\` (one of ${list(REVERSIBILITY)}).`,
  '- `timing` (optional): `first_round`, `prior_unresolved`, `since_prior_head`, or `late`; the default is `first_round`.',
  '',
  'Valid `sources` entries (invented values):',
  '',
  '```json',
  ...CONTRACT_SOURCE_EXAMPLES.map(json),
  '```',
  '',
  'A valid packet (the values are invented and say nothing about this PR):',
  '',
  '```json',
  JSON.stringify(CONTRACT_PACKET_EXAMPLE, null, 2),
  '```',
].join('\n');

function requireArray(packet, field) {
  if (!Array.isArray(packet[field])) {
    throw new Error(`${field} must be an array`);
  }
}

export function validatePacket(packet) {
  for (const field of [
    'concern_id',
    'origin_or_contract_anchor',
    'current_contract_owner',
    'new_contract_delta',
    'verdict',
    'history_status',
    'use_ordinal',
  ]) {
    if (typeof packet[field] !== 'string' || packet[field].length === 0) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
  for (const field of [
    'recent_semantic_changes',
    'competing_owners_or_representations',
    'branching_conditions',
    'sources',
  ]) {
    requireArray(packet, field);
  }
  for (const change of packet.recent_semantic_changes) {
    if (
      !Number.isInteger(change.pr) ||
      !SHA_PATTERN.test(change.sha ?? '') ||
      !Number.isInteger(change.timestamp) ||
      typeof change.summary !== 'string' ||
      change.summary.length === 0
    ) {
      throw new Error('Each recent_semantic_changes entry must include pr, sha, timestamp, and summary');
    }
  }
  for (const source of packet.sources) {
    if (
      !SOURCE_KINDS.has(source.kind) ||
      typeof source.selection_reason !== 'string' ||
      source.selection_reason.length === 0
    ) {
      throw new Error('Each source must include kind and selection_reason');
    }
    if ((source.kind === 'pr' || source.kind === 'issue') && !Number.isInteger(source.id)) {
      throw new Error(`${source.kind} sources must include a numeric id`);
    }
    if ((source.kind === 'pr' || source.kind === 'commit') && !SHA_PATTERN.test(source.sha ?? '')) {
      throw new Error(`${source.kind} sources must include a commit SHA`);
    }
  }
  if (!VERDICTS.has(packet.verdict)) {
    throw new Error(`Unknown verdict: ${packet.verdict}`);
  }
  if (!ORDINALS.has(packet.use_ordinal)) {
    throw new Error(`Unknown use ordinal: ${packet.use_ordinal}`);
  }
  if (!HISTORY_STATUSES.has(packet.history_status)) {
    throw new Error(`Unknown history status: ${packet.history_status}`);
  }
  if (typeof packet.has_recorded_anchor !== 'boolean') {
    throw new Error('has_recorded_anchor must be a boolean');
  }
  if (typeof packet.anchor_violated !== 'boolean') {
    throw new Error('anchor_violated must be a boolean');
  }
  if (packet.anchor_violated && !packet.has_recorded_anchor) {
    throw new Error('anchor_violated requires has_recorded_anchor to be true');
  }
  if (!Number.isInteger(packet.same_bug_count) || packet.same_bug_count < 0) {
    throw new Error('same_bug_count must be a non-negative integer');
  }
  return packet;
}

export function classifyContractState(packet) {
  validatePacket(packet);
  if (
    packet.verdict === 'insufficient_history' ||
    (packet.history_status !== 'complete' && !packet.has_recorded_anchor)
  ) {
    return {
      effective_verdict: 'insufficient_history',
      kind: 'suggestion',
      severity: 'low',
      requires_observation: true,
    };
  }
  if (packet.verdict === 'follows_contract' || packet.verdict === 'coherent_extension') {
    return { effective_verdict: packet.verdict, kind: null, severity: null, requires_observation: false };
  }
  if (packet.verdict === 'contract_missing') {
    return {
      effective_verdict: 'contract_missing',
      kind: 'suggestion',
      severity: 'medium',
      requires_observation: true,
    };
  }

  const matureTripwire =
    packet.anchor_violated || packet.use_ordinal === 'third_or_later' || packet.same_bug_count >= 2;
  const defect = matureTripwire && packet.branching_conditions.length > 0;
  return {
    effective_verdict: 'contract_branching',
    kind: defect ? 'defect' : 'suggestion',
    severity: defect ? 'high' : 'medium',
    requires_observation: true,
  };
}

function synthesizeInsufficientHistoryFinding(packet) {
  return {
    finding_id: `contract-evolution-${packet.concern_id}-insufficient-history`,
    title: `Insufficient history for ${packet.concern_id}: ${packet.verdict} could not be confirmed`,
    evidence: [
      `history_status: ${packet.history_status}`,
      'has_recorded_anchor: false',
      `sub_agent_verdict: ${packet.verdict}`,
    ],
    why_it_matters:
      'The scan could not verify the contract verdict against complete history or a recorded anchor, so contract branching may be invisible.',
    suggested_action: `Record a contract anchor for ${packet.concern_id} in docs/design/CONCERN_DETAILS.md or re-run the scan with complete history.`,
    reversibility: 'unknown',
    applies_to_files: [],
  };
}

export function buildObservation(packet) {
  const state = classifyContractState(packet);
  if (!state.requires_observation) {
    return null;
  }

  let finding = packet.finding;
  if (
    !finding &&
    state.effective_verdict === 'insufficient_history' &&
    (packet.verdict === 'follows_contract' || packet.verdict === 'coherent_extension')
  ) {
    finding = synthesizeInsufficientHistoryFinding(packet);
  }
  if (!finding || typeof finding !== 'object') {
    throw new Error('A non-clean packet must include finding');
  }
  for (const field of ['finding_id', 'title', 'why_it_matters', 'suggested_action']) {
    if (typeof finding[field] !== 'string' || finding[field].length === 0) {
      throw new Error(`finding.${field} must be a non-empty string`);
    }
  }
  requireArray(finding, 'evidence');
  requireArray(finding, 'applies_to_files');
  if (!REVERSIBILITY.has(finding.reversibility)) {
    throw new Error(`Unknown finding reversibility: ${finding.reversibility}`);
  }

  return validateObservation({
    concern_id: packet.concern_id,
    finding_id: finding.finding_id,
    kind: state.kind,
    severity: state.severity,
    confidence:
      state.effective_verdict === 'insufficient_history'
        ? 'low'
        : packet.history_status === 'complete' || packet.has_recorded_anchor
          ? 'high'
          : 'low',
    title: finding.title,
    evidence: finding.evidence,
    why_it_matters: finding.why_it_matters,
    suggested_action: finding.suggested_action,
    reversibility: finding.reversibility,
    applies_to_files: finding.applies_to_files,
    origin: state.kind === 'defect' ? 'regression' : 'pre_existing',
    impact: state.kind === 'defect' ? 'ordinary' : 'none',
    timing: packet.timing ?? 'first_round',
    scope_effect: state.kind === 'defect' ? 'within_changed_surface' : 'widens_changed_surface',
    breaks_shipped_path: false,
    induced: false,
  });
}

function main() {
  const packetPath = process.argv[2];
  if (!packetPath || process.argv.length !== 3) {
    throw new Error('Expected one path to a contract evolution packet JSON file');
  }
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const state = classifyContractState(packet);
  const observation = buildObservation(packet);
  process.stdout.write(`${JSON.stringify({ packet, state, observation }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
