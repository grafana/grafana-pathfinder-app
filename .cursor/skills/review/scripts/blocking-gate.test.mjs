import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideBlocking } from './blocking-gate.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function finding(overrides = {}) {
  return {
    finding_id: 'GATE-1',
    concern_id: 'correctness-and-reliability',
    severity: 'high',
    recommended_disposition: 'blocking',
    ...overrides,
  };
}

// A warranted blocker: a regression this PR introduces, on a live path, at round 1,
// with no precedent and no way to bound it behind a follow-up.
function warrantedAnswers(overrides = {}) {
  return {
    round: 1,
    override: null,
    authorship: 'regression',
    breaks_live_path: true,
    concrete_risk_now: true,
    boundable_by_followup: false,
    precedent_count: 0,
    induced_by_prior_suggestion: false,
    ...overrides,
  };
}

function decide(answers, findingOverrides = {}) {
  return decideBlocking({ finding: finding(findingOverrides), answers: warrantedAnswers(answers) });
}

test('row 9 — a regression on a live path with no precedent and no bound blocks as warranted', () => {
  assert.deepEqual(decide({}), { disposition: 'blocking', reason: 'warranted', gate_failures: [] });
});

test('row 1 — an override blocks unconditionally and still records what would have demoted it', () => {
  for (const override of ['security', 'data_loss', 'credential_exposure', 'shipped_path_breakage']) {
    const decision = decide({
      override,
      round: 3,
      attribution: 'late',
      late_blocker_reason: 'Not raised at rounds 1 or 2.',
      authorship: 'pre_existing',
      breaks_live_path: false,
      concrete_risk_now: false,
      boundable_by_followup: true,
      precedent_count: 11,
      induced_by_prior_suggestion: true,
    });

    assert.equal(decision.disposition, 'blocking', override);
    assert.equal(decision.reason, 'unconditional-override', override);
    assert.deepEqual(decision.gate_failures, [
      'late-peripheral',
      'policy-change',
      'induced-scope',
      'pre-existing',
      'no-live-impact',
      'safely-bounded',
    ]);
  }
});

test('row 2 — a late peripheral finding demotes, and a late live-path regression still blocks', () => {
  const late = {
    round: 3,
    attribution: 'late',
    late_blocker_reason: 'Not raised at rounds 1 or 2.',
  };

  assert.deepEqual(decide({ ...late, authorship: 'pre_existing' }), {
    disposition: 'follow_up',
    reason: 'late-peripheral',
    gate_failures: ['late-peripheral', 'pre-existing'],
  });
  assert.deepEqual(decide({ ...late, authorship: 'regression', breaks_live_path: true }), {
    disposition: 'blocking',
    reason: 'warranted',
    gate_failures: [],
  });
  assert.equal(decide({ ...late, authorship: 'regression', breaks_live_path: false }).reason, 'late-peripheral');
});

test('row 2 — a prior unresolved or newly attributable blocker is not demoted by attribution', () => {
  for (const attribution of ['prior_unresolved', 'since_prior_head']) {
    assert.equal(decide({ round: 2, attribution }).disposition, 'blocking', attribution);
  }
});

test('row 3 — precedent of two or more already-merged PRs makes it a policy change', () => {
  assert.equal(decide({ precedent_count: 1 }).disposition, 'blocking');
  assert.deepEqual(decide({ precedent_count: 2 }), {
    disposition: 'follow_up',
    reason: 'policy-change',
    gate_failures: ['policy-change'],
  });
  assert.equal(decide({ precedent_count: 11 }).reason, 'policy-change');
});

test('row 4 — a blocker induced by a prior-round suggestion demotes', () => {
  assert.deepEqual(decide({ induced_by_prior_suggestion: true }), {
    disposition: 'follow_up',
    reason: 'induced-scope',
    gate_failures: ['induced-scope'],
  });
});

test('row 5 — a pre-existing condition demotes regardless of severity', () => {
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const decision = decide({ authorship: 'pre_existing' }, { severity });
    assert.equal(decision.disposition, 'follow_up', severity);
    assert.equal(decision.reason, 'pre-existing', severity);
  }
});

test('row 6 — a latent condition this PR exposes demotes only while it stays unreachable', () => {
  assert.deepEqual(decide({ authorship: 'latent_exposed', latent_reachable: false }), {
    disposition: 'follow_up',
    reason: 'latent-unreachable',
    gate_failures: ['latent-unreachable'],
  });
  assert.equal(decide({ authorship: 'latent_exposed', latent_reachable: true }).disposition, 'blocking');
});

test('row 7 — a finding with neither live breakage nor concrete risk now demotes', () => {
  assert.deepEqual(decide({ breaks_live_path: false, concrete_risk_now: false }), {
    disposition: 'follow_up',
    reason: 'no-live-impact',
    gate_failures: ['no-live-impact'],
  });
  assert.equal(decide({ breaks_live_path: false, concrete_risk_now: true }).disposition, 'blocking');
});

test('row 8 — a finding safely bounded by a follow-up demotes', () => {
  assert.deepEqual(decide({ boundable_by_followup: true }), {
    disposition: 'follow_up',
    reason: 'safely-bounded',
    gate_failures: ['safely-bounded'],
  });
});

test('rejects a finding the reviewer did not recommend as blocking', () => {
  for (const recommended of ['follow_up', 'suggestion', 'nit']) {
    assert.throws(
      () => decide({}, { recommended_disposition: recommended }),
      /runs only on a finding recommended as blocking/,
      recommended
    );
  }
});

test('rejects answers that leave the ratchet unable to reason', () => {
  assert.throws(() => decide({ round: 2, attribution: undefined }), /attribution is required from round 2 onward/);
  assert.throws(() => decide({ round: 0 }), /round must be an integer between 1 and 100/);
  assert.throws(() => decide({ override: 'performance' }), /Unknown override: performance/);
  assert.throws(() => decide({ authorship: 'theirs' }), /Unknown authorship: theirs/);
  assert.throws(() => decide({ round: 2, attribution: 'someday' }), /Unknown attribution: someday/);
  assert.throws(() => decide({ authorship: 'latent_exposed' }), /latent_reachable is required/);
  assert.throws(() => decide({ precedent_count: -1 }), /precedent_count must be a non-negative integer/);
  assert.throws(() => decide({ breaks_live_path: 'yes' }), /breaks_live_path must be true or false/);
  assert.throws(
    () => decide({ round: 2, attribution: 'late', late_blocker_reason: '  ' }),
    /late blocker must record a late_blocker_reason/
  );
});

test('rejects a contradicted clearance that states no new evidence', () => {
  const contradicting = (contradicts_cleared) =>
    decide({
      round: 3,
      attribution: 'late',
      late_blocker_reason: 'Not raised at rounds 1 or 2.',
      breaks_live_path: false,
      contradicts_cleared,
    });

  assert.throws(
    () => contradicting({ claim: 'Forward compatibility', reason: 'Eleven prior block types.' }),
    /requires non-empty new_evidence/
  );
  assert.throws(
    () => contradicting({ claim: 'Forward compatibility', reason: 'Eleven prior block types.', new_evidence: '   ' }),
    /requires non-empty new_evidence/
  );
  assert.throws(() => contradicting({ new_evidence: 'Durable persistence is new.' }), /must quote the cleared claim/);
  assert.equal(
    contradicting({
      claim: 'Forward compatibility with the closed block union',
      reason: 'Documented contract; eleven prior block types.',
      new_evidence: 'The editor now writes the block into durable App Platform resources.',
    }).disposition,
    'follow_up'
  );
});

test('the CLI emits the decision for a serialized finding and answer set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blocking-gate-'));
  tempDirs.push(dir);
  const inputPath = join(dir, 'input.json');
  writeFileSync(
    inputPath,
    JSON.stringify({ finding: finding(), answers: warrantedAnswers({ induced_by_prior_suggestion: true }) })
  );
  const output = execFileSync('node', [join(scriptDir, 'blocking-gate.mjs'), inputPath], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), {
    disposition: 'follow_up',
    reason: 'induced-scope',
    gate_failures: ['induced-scope'],
  });
});

// The acceptance fixture for this gate: PR #1702 (`feat: add divider guide blocks`, author
// `loglapa`), which took three CHANGES_REQUESTED rounds before approval. Every finding below is
// transcribed from the real review bodies, and `carried_follow_ups` records what a prior round
// deferred. The design's claim is that round 3 produces zero blockers and two follow-ups, which is
// the outcome the human approval reached by hand through issues #1720, #1705, and #1706.
const PR_1702 = [
  {
    round: 1,
    proposed_blockers: [
      {
        finding: {
          finding_id: 'ACK-1702-1',
          concern_id: 'correctness-and-reliability',
          severity: 'medium',
          recommended_disposition: 'blocking',
        },
        // "This is not a new bug. A trailing markdown block does the same, and it is the
        // intended #842 behavior."
        answers: {
          round: 1,
          override: null,
          authorship: 'pre_existing',
          breaks_live_path: false,
          concrete_risk_now: false,
          boundable_by_followup: true,
          precedent_count: 1,
          induced_by_prior_suggestion: false,
        },
        expected: 'pre-existing',
      },
      {
        finding: {
          finding_id: 'DOC-1702-1',
          concern_id: 'documentation',
          severity: 'low',
          recommended_disposition: 'blocking',
        },
        // The PR added `divider` to `PresentationalBlockSchema`, so the collapsible block list in
        // `json-guide-format.md` went stale. A regression, but nothing live breaks.
        answers: {
          round: 1,
          override: null,
          authorship: 'regression',
          breaks_live_path: false,
          concrete_risk_now: false,
          boundable_by_followup: true,
          precedent_count: 0,
          induced_by_prior_suggestion: false,
        },
        expected: 'no-live-impact',
      },
    ],
    carried_follow_ups: 0,
  },
  {
    round: 2,
    proposed_blockers: [
      {
        finding: {
          finding_id: 'CONV-1702-1',
          concern_id: 'contracts-and-schemas',
          severity: 'high',
          recommended_disposition: 'blocking',
        },
        // Round 1's *optional* item suggested wiring divider into the collapsible picker. The
        // contributor went further and added `TypeSwitchDropdown`; this blocker is entirely about
        // that dropdown, so it did not exist in the code under review at round 1.
        answers: {
          round: 2,
          override: null,
          attribution: 'since_prior_head',
          authorship: 'regression',
          breaks_live_path: false,
          concrete_risk_now: true,
          boundable_by_followup: false,
          precedent_count: 0,
          induced_by_prior_suggestion: true,
        },
        expected: 'induced-scope',
      },
    ],
    // Round 1's two demoted findings were fixed before round 2 ("The acknowledgement behavior,
    // documentation, collapsible authoring, and side-effect classification now look correct").
    carried_follow_ups: 0,
  },
  {
    round: 3,
    proposed_blockers: [
      {
        finding: {
          finding_id: 'RWD-1702-1',
          concern_id: 'reversibility-and-one-way-door',
          severity: 'high',
          recommended_disposition: 'blocking',
        },
        answers: {
          round: 3,
          override: null,
          authorship: 'latent_exposed',
          latent_reachable: false,
          breaks_live_path: false,
          concrete_risk_now: false,
          boundable_by_followup: true,
          precedent_count: 11,
          induced_by_prior_suggestion: false,
          prior_contract_satisfied: true,
          attribution: 'late',
          late_blocker_reason: 'Not raised at rounds 1 or 2.',
          contradicts_cleared: {
            claim: 'Forward compatibility with the closed block union',
            reason: 'Documented contract; eleven prior block types.',
            new_evidence: 'The editor now writes the block into durable App Platform resources.',
          },
        },
        expected: 'late-peripheral',
      },
    ],
    // `CONV-1702-1` was deferred at round 2 and is not re-litigated, but stays tracked.
    carried_follow_ups: 1,
  },
];

test('the PR #1702 sequence ends at zero blockers and two follow-ups', () => {
  const tally = PR_1702.map((round) => {
    const decisions = round.proposed_blockers.map((entry) => {
      const decision = decideBlocking(entry);
      assert.equal(decision.reason, entry.expected, `${entry.finding.finding_id} at round ${round.round}`);
      return decision;
    });
    return {
      round: round.round,
      blocking: decisions.filter((decision) => decision.disposition === 'blocking').length,
      follow_ups:
        decisions.filter((decision) => decision.disposition === 'follow_up').length + round.carried_follow_ups,
    };
  });

  assert.deepEqual(tally, [
    { round: 1, blocking: 0, follow_ups: 2 },
    { round: 2, blocking: 0, follow_ups: 1 },
    { round: 3, blocking: 0, follow_ups: 2 },
  ]);
});
