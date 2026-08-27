import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideDisposition } from './disposition-policy.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function blocker(overrides = {}) {
  return {
    finding: {
      severity: 'high',
      recommended_disposition: 'blocking',
    },
    context: {
      review_mode: 'full',
      evaluator_source: 'stable',
      evidence_origin: 'full_diff',
      impact: 'direct',
      deterministic_reproduction: true,
      direct_material_impact: true,
      deferral_safe: false,
      finite_fix: true,
    },
    ...overrides,
  };
}

test('keeps a directly reproduced material defect blocking on a full review', () => {
  assert.deepEqual(decideDisposition(blocker()), {
    disposition: 'blocking',
    blocking_eligible: true,
    reason: 'blocking_criteria_met',
  });
});

test('preserves a reviewer suggestion without blocker adjudication', () => {
  const input = blocker();
  input.finding.recommended_disposition = 'suggestion';

  assert.deepEqual(decideDisposition(input), {
    disposition: 'suggestion',
    blocking_eligible: false,
    reason: 'reviewer_non_blocking',
  });
});

test('caps a hypothetical coverage gap at suggestion', () => {
  const input = blocker();
  input.context.impact = 'hypothetical_coverage_gap';

  assert.deepEqual(decideDisposition(input), {
    disposition: 'suggestion',
    blocking_eligible: false,
    reason: 'non_blocking_impact',
  });
});

test('caps a low-severity candidate at suggestion', () => {
  const input = blocker();
  input.finding.severity = 'low';

  assert.deepEqual(decideDisposition(input), {
    disposition: 'suggestion',
    blocking_eligible: false,
    reason: 'severity_too_low',
  });
});

test('caps a non-critical unchanged finding during incremental review at suggestion', () => {
  const input = blocker();
  input.context.review_mode = 'incremental';
  input.context.evidence_origin = 'unchanged';

  assert.deepEqual(decideDisposition(input), {
    disposition: 'suggestion',
    blocking_eligible: false,
    reason: 'outside_incremental_merge_contract',
  });
});

test('allows a deterministically reproduced latent critical issue during incremental review', () => {
  const input = blocker();
  input.finding.severity = 'critical';
  input.context.review_mode = 'incremental';
  input.context.evidence_origin = 'unchanged';

  assert.equal(decideDisposition(input).disposition, 'blocking');
});

test('caps an unproved head-version self-smoke finding at suggestion', () => {
  const input = blocker();
  input.context.evaluator_source = 'head_smoke';
  input.context.deterministic_reproduction = false;

  assert.deepEqual(decideDisposition(input), {
    disposition: 'suggestion',
    blocking_eligible: false,
    reason: 'unproved_self_smoke',
  });
});

test('requires direct material impact, unsafe deferral, and a finite fix for a blocker', () => {
  for (const [field, value] of [
    ['direct_material_impact', false],
    ['deferral_safe', true],
    ['finite_fix', false],
  ]) {
    const input = blocker();
    input.context[field] = value;
    assert.equal(decideDisposition(input).disposition, 'suggestion', field);
  }
});

test('rejects an incomplete blocker basis', () => {
  const input = blocker();
  delete input.context.finite_fix;

  assert.throws(() => decideDisposition(input), /finite_fix is required/);
});

test('the CLI adjudicates a serialized finding and blocker basis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'disposition-policy-'));
  const inputPath = join(dir, 'input.json');
  try {
    writeFileSync(inputPath, JSON.stringify(blocker()));
    const output = execFileSync('node', [join(scriptDir, 'disposition-policy.mjs'), inputPath], {
      encoding: 'utf8',
    });
    assert.equal(JSON.parse(output).disposition, 'blocking');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
