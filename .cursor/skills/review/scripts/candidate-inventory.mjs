import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const DISPOSITIONS = new Set(['blocking', 'suggestion', 'nit']);
const REVERSIBILITY = new Set(['reversible', 'partially_reversible', 'irreversible_without_cleanup', 'unknown']);
const EVIDENCE_ORIGINS = new Set(['full_diff', 'incremental_diff', 'prior_blocker', 'unchanged']);
const IMPACTS = new Set(['direct', 'hypothetical_coverage_gap', 'documentation_drift', 'tech_debt']);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireEnum(value, values, field) {
  if (!values.has(value)) {
    throw new Error(`${field} is invalid`);
  }
}

function validateCandidate(candidate) {
  if (!candidate || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(candidate.finding_id ?? '')) {
    throw new Error('finding_id must be stable');
  }
  requireEnum(candidate.severity, SEVERITIES, 'severity');
  requireEnum(candidate.confidence, CONFIDENCES, 'confidence');
  requireEnum(candidate.recommended_disposition, DISPOSITIONS, 'recommended_disposition');
  requireEnum(candidate.reversibility, REVERSIBILITY, 'reversibility');
  for (const field of ['title', 'why_it_matters', 'suggested_action']) {
    requireString(candidate[field], field);
  }
  for (const field of ['evidence', 'applies_to_files']) {
    if (!Array.isArray(candidate[field]) || candidate[field].length === 0) {
      throw new Error(`${field} must be a non-empty array`);
    }
    for (const value of candidate[field]) {
      requireString(value, field);
    }
  }
  const context = candidate.disposition_context;
  if (!context || typeof context !== 'object') {
    throw new Error('disposition_context is required');
  }
  requireEnum(context.evidence_origin, EVIDENCE_ORIGINS, 'evidence_origin');
  requireEnum(context.impact, IMPACTS, 'impact');
  for (const field of ['deterministic_reproduction', 'direct_material_impact', 'deferral_safe', 'finite_fix']) {
    if (typeof context[field] !== 'boolean') {
      throw new Error(`${field} is required and must be boolean`);
    }
  }
}

export function validateCandidateInventory(inventory) {
  if (!inventory || !/^[a-z0-9-]+$/.test(inventory.concern_id ?? '')) {
    throw new Error('concern_id must be a concern identifier');
  }
  if (inventory.status === 'no_findings') {
    if (!['not_applicable', 'reviewed_clean'].includes(inventory.reason)) {
      throw new Error('a clean inventory reason must be not_applicable or reviewed_clean');
    }
    if (inventory.findings !== undefined) {
      throw new Error('a clean inventory must not include findings');
    }
    return inventory;
  }
  if (!Array.isArray(inventory.findings)) {
    throw new Error('findings must be an array');
  }
  const seen = new Set();
  for (const candidate of inventory.findings) {
    validateCandidate(candidate);
    if (seen.has(candidate.finding_id)) {
      throw new Error(`candidate id ${candidate.finding_id} must be unique`);
    }
    seen.add(candidate.finding_id);
  }
  return inventory;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    throw new Error('Expected one path to a candidate inventory JSON file');
  }
  const inventory = validateCandidateInventory(JSON.parse(readFileSync(inputPath, 'utf8')));
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
