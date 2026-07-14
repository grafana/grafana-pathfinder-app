#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  if (!Number.isInteger(packet.same_bug_count) || packet.same_bug_count < 0) {
    throw new Error('same_bug_count must be a non-negative integer');
  }
  return packet;
}

export function decideDisposition(packet) {
  validatePacket(packet);
  if (packet.verdict === 'insufficient_history') {
    return {
      effective_verdict: 'insufficient_history',
      disposition: 'advisory',
      severity: 'low',
      requires_finding: true,
    };
  }
  if (packet.history_status !== 'complete' && !packet.has_recorded_anchor) {
    return {
      effective_verdict: 'insufficient_history',
      disposition: 'advisory',
      severity: 'low',
      requires_finding: true,
    };
  }
  if (packet.verdict === 'follows_contract' || packet.verdict === 'coherent_extension') {
    return { effective_verdict: packet.verdict, disposition: 'none', severity: null, requires_finding: false };
  }
  if (packet.verdict === 'contract_missing') {
    return {
      effective_verdict: 'contract_missing',
      disposition: 'advisory',
      severity: 'medium',
      requires_finding: true,
    };
  }

  const matureTripwire =
    packet.has_recorded_anchor || packet.use_ordinal === 'third_or_later' || packet.same_bug_count >= 2;
  const blocking = matureTripwire && packet.branching_conditions.length > 0;
  return {
    effective_verdict: 'contract_branching',
    disposition: blocking ? 'blocking' : 'advisory',
    severity: blocking ? 'high' : 'medium',
    requires_finding: true,
  };
}

export function buildFinding(packet) {
  const decision = decideDisposition(packet);
  if (!decision.requires_finding) {
    return null;
  }

  const finding = packet.finding;
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

  return {
    concern_id: packet.concern_id,
    finding_id: finding.finding_id,
    severity: decision.severity,
    confidence:
      decision.effective_verdict === 'insufficient_history'
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
    disposition: decision.disposition,
  };
}

function main() {
  const packetPath = process.argv[2];
  if (!packetPath || process.argv.length !== 3) {
    throw new Error('Expected one path to a contract evolution packet JSON file');
  }
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const decision = decideDisposition(packet);
  const finding = buildFinding(packet);
  process.stdout.write(`${JSON.stringify({ packet, decision, finding }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
