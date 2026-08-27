import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCandidateInventory } from './candidate-inventory.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function candidate(id) {
  return {
    finding_id: id,
    severity: 'medium',
    confidence: 'high',
    recommended_disposition: 'suggestion',
    title: 'Keep the review contract coherent',
    evidence: ['The changed hunk violates the recorded invariant.'],
    why_it_matters: 'The review can miss a regression.',
    suggested_action: 'Align the implementation with the invariant.',
    reversibility: 'reversible',
    applies_to_files: ['src/example.ts'],
    disposition_context: {
      evidence_origin: 'full_diff',
      impact: 'direct',
      deterministic_reproduction: true,
      direct_material_impact: true,
      deferral_safe: false,
      finite_fix: true,
    },
  };
}

test('accepts every concrete finding in one concern inventory', () => {
  const inventory = {
    concern_id: 'correctness-and-reliability',
    findings: [candidate('CORRECTNESS-001'), candidate('CORRECTNESS-002')],
  };

  assert.equal(validateCandidateInventory(inventory), inventory);
});

test('rejects the legacy singleton shape and duplicate candidate ids', () => {
  assert.throws(
    () => validateCandidateInventory({ concern_id: 'security', ...candidate('SECURITY-001') }),
    /findings must be an array/
  );
  assert.throws(
    () =>
      validateCandidateInventory({
        concern_id: 'security',
        findings: [candidate('SECURITY-001'), candidate('SECURITY-001')],
      }),
    /candidate id SECURITY-001 must be unique/
  );
});

test('accepts an explicit clean concern result', () => {
  const inventory = {
    concern_id: 'security',
    status: 'no_findings',
    reason: 'reviewed_clean',
  };

  assert.equal(validateCandidateInventory(inventory), inventory);
});

test('the CLI validates a serialized inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'candidate-inventory-'));
  const inputPath = join(dir, 'input.json');
  const inventory = { concern_id: 'security', findings: [candidate('SECURITY-001')] };
  try {
    writeFileSync(inputPath, JSON.stringify(inventory));
    const output = execFileSync('node', [join(scriptDir, 'candidate-inventory.mjs'), inputPath], {
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(output), inventory);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
