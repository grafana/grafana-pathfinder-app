import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideBlocking } from './blocking-gate.mjs';
import { advanceReviewPolicy } from './review-policy.mjs';
import { parseReviewState, renderReviewReport } from './review-report.mjs';

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

// A live path this PR itself breaks is shipped_path_breakage, which the gate derives into an
// override before any demotion row runs. Rows 2, 3, 4, and 8 are therefore reachable only for a
// finding that is not one: concrete risk at this head, but no shipped path breaking.
const NOT_A_SHIPPED_PATH_BREAKAGE = {
  authorship: 'latent_exposed',
  latent_reachable: true,
  breaks_live_path: false,
  concrete_risk_now: true,
};

test('row 9 — a reachable condition with concrete risk now, no precedent and no bound, blocks as warranted', () => {
  assert.deepEqual(decide(NOT_A_SHIPPED_PATH_BREAKAGE), {
    disposition: 'blocking',
    reason: 'warranted',
    override: null,
    override_source: null,
    gate_failures: [],
  });
});

test('row 1 — an override blocks unconditionally and still records what would have demoted it', () => {
  const everythingDemoting = {
    round: 3,
    attribution: 'late',
    late_blocker_reason: 'Not raised at rounds 1 or 2.',
    breaks_live_path: false,
    concrete_risk_now: false,
    boundable_by_followup: true,
    precedent_count: 11,
    induced_by_prior_suggestion: true,
  };

  for (const override of ['security', 'data_loss', 'credential_exposure', 'shipped_path_breakage']) {
    const decision = decide({ ...everythingDemoting, override, authorship: 'pre_existing' });

    assert.equal(decision.disposition, 'blocking', override);
    assert.equal(decision.reason, 'unconditional-override', override);
    assert.equal(decision.override, override);
    assert.equal(decision.override_source, 'supplied', override);
    assert.deepEqual(decision.gate_failures, [
      'late-peripheral',
      'policy-change',
      'induced-scope',
      'pre-existing',
      'no-live-impact',
      'safely-bounded',
    ]);
  }

  // No answer set makes all seven demotion rules hold, so the order is pinned by one fixture per
  // authorship. Together these cover every adjacent pair an input can observe.
  assert.deepEqual(
    decide({
      ...everythingDemoting,
      override: 'security',
      authorship: 'latent_exposed',
      latent_reachable: false,
    }).gate_failures,
    ['late-peripheral', 'policy-change', 'induced-scope', 'latent-unreachable', 'no-live-impact', 'safely-bounded']
  );
});

test('row 1 — the gate derives shipped_path_breakage whenever this PR is what breaks the shipped path', () => {
  const late = {
    round: 3,
    attribution: 'late',
    late_blocker_reason: 'Not raised at rounds 1 or 2.',
  };

  for (const authorship of [{ authorship: 'regression' }, { authorship: 'latent_exposed', latent_reachable: true }]) {
    assert.deepEqual(
      decide({ ...late, ...authorship, breaks_live_path: true, concrete_risk_now: true }),
      {
        disposition: 'blocking',
        reason: 'unconditional-override',
        override: 'shipped_path_breakage',
        override_source: 'derived',
        gate_failures: ['late-peripheral'],
      },
      authorship.authorship
    );
  }

  assert.deepEqual(decide({ ...late, authorship: 'pre_existing', breaks_live_path: true, concrete_risk_now: true }), {
    disposition: 'follow_up',
    reason: 'late-peripheral',
    override: null,
    override_source: null,
    gate_failures: ['late-peripheral', 'pre-existing'],
  });
});

test('row 1 — the gate derives shipped_path_breakage for a live-path regression the reviewer left open', () => {
  assert.deepEqual(decide({ boundable_by_followup: true }), {
    disposition: 'blocking',
    reason: 'unconditional-override',
    override: 'shipped_path_breakage',
    override_source: 'derived',
    gate_failures: ['safely-bounded'],
  });

  assert.deepEqual(
    decide({
      round: 3,
      attribution: 'late',
      late_blocker_reason: 'Not raised at rounds 1 or 2.',
      boundable_by_followup: true,
      precedent_count: 11,
      induced_by_prior_suggestion: true,
    }),
    {
      disposition: 'blocking',
      reason: 'unconditional-override',
      override: 'shipped_path_breakage',
      override_source: 'derived',
      gate_failures: ['late-peripheral', 'policy-change', 'induced-scope', 'safely-bounded'],
    }
  );
});

test('row 1 — a supplied override wins over the derived one rather than being replaced', () => {
  assert.deepEqual(decide({ override: 'security' }), {
    disposition: 'blocking',
    reason: 'unconditional-override',
    override: 'security',
    override_source: 'supplied',
    gate_failures: [],
  });
  assert.throws(() => decide({ override: 'performance' }), /Unknown override: performance/);
});

test('row 1 — the derivation needs a live path this PR broke, and fires for neither half alone', () => {
  assert.deepEqual(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, boundable_by_followup: true }), {
    disposition: 'follow_up',
    reason: 'safely-bounded',
    override: null,
    override_source: null,
    gate_failures: ['safely-bounded'],
  });
  assert.deepEqual(decide({ breaks_live_path: false, boundable_by_followup: true }), {
    disposition: 'follow_up',
    reason: 'safely-bounded',
    override: null,
    override_source: null,
    gate_failures: ['safely-bounded'],
  });
  assert.deepEqual(
    decide({ authorship: 'latent_exposed', latent_reachable: false, boundable_by_followup: true }).gate_failures,
    ['latent-unreachable', 'safely-bounded']
  );
});

test('row 2 — a late finding demotes on lateness alone, whatever else holds', () => {
  const late = {
    round: 3,
    attribution: 'late',
    late_blocker_reason: 'Not raised at rounds 1 or 2.',
  };

  assert.deepEqual(decide({ ...late, authorship: 'pre_existing' }), {
    disposition: 'follow_up',
    reason: 'late-peripheral',
    override: null,
    override_source: null,
    gate_failures: ['late-peripheral', 'pre-existing'],
  });
  assert.equal(decide({ ...late, authorship: 'regression', breaks_live_path: false }).reason, 'late-peripheral');
});

test('row 2 — a prior unresolved or newly attributable blocker is not demoted by attribution', () => {
  for (const attribution of ['prior_unresolved', 'since_prior_head']) {
    assert.deepEqual(
      decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, round: 2, attribution }),
      {
        disposition: 'blocking',
        reason: 'warranted',
        override: null,
        override_source: null,
        gate_failures: [],
      },
      attribution
    );
  }
});

test('row 3 — precedent of two or more already-merged PRs makes it a policy change', () => {
  assert.equal(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, precedent_count: 1 }).disposition, 'blocking');
  assert.deepEqual(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, precedent_count: 2 }), {
    disposition: 'follow_up',
    reason: 'policy-change',
    override: null,
    override_source: null,
    gate_failures: ['policy-change'],
  });
  assert.equal(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, precedent_count: 11 }).reason, 'policy-change');
});

test('row 4 — a blocker induced by a prior-round suggestion demotes', () => {
  assert.deepEqual(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, induced_by_prior_suggestion: true }), {
    disposition: 'follow_up',
    reason: 'induced-scope',
    override: null,
    override_source: null,
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
    override: null,
    override_source: null,
    gate_failures: ['latent-unreachable'],
  });
  assert.equal(decide({ authorship: 'latent_exposed', latent_reachable: true }).disposition, 'blocking');
});

test('row 7 — a finding with neither live breakage nor concrete risk now demotes', () => {
  assert.deepEqual(decide({ breaks_live_path: false, concrete_risk_now: false }), {
    disposition: 'follow_up',
    reason: 'no-live-impact',
    override: null,
    override_source: null,
    gate_failures: ['no-live-impact'],
  });
  assert.equal(decide({ breaks_live_path: false, concrete_risk_now: true }).disposition, 'blocking');
});

test('row 8 — a finding safely bounded by a follow-up demotes', () => {
  assert.deepEqual(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, boundable_by_followup: true }), {
    disposition: 'follow_up',
    reason: 'safely-bounded',
    override: null,
    override_source: null,
    gate_failures: ['safely-bounded'],
  });
});

test('a round past the marker bound still gates, clamped rather than rejected', () => {
  const late = { attribution: 'late', late_blocker_reason: 'Not raised at rounds 1 or 2.' };

  assert.deepEqual(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, ...late, round: 100 }), {
    disposition: 'follow_up',
    reason: 'late-peripheral',
    override: null,
    override_source: null,
    gate_failures: ['late-peripheral'],
  });
  assert.deepEqual(
    decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, ...late, round: 4096 }),
    decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, ...late, round: 100 })
  );
  assert.throws(
    () => decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, round: 4096, attribution: undefined }),
    /attribution is required from round 2 onward/
  );
});

test('a one-way door is not boundable by a follow-up, so rows 7 and 8 cannot demote it', () => {
  const bounded = { ...NOT_A_SHIPPED_PATH_BREAKAGE, boundable_by_followup: true };
  const inert = { ...NOT_A_SHIPPED_PATH_BREAKAGE, breaks_live_path: false, concrete_risk_now: false };

  for (const reversibility of ['partially_reversible', 'irreversible_without_cleanup']) {
    assert.deepEqual(
      decide(bounded, { reversibility }),
      { disposition: 'blocking', reason: 'warranted', override: null, override_source: null, gate_failures: [] },
      `${reversibility} bounded by a follow-up`
    );
    assert.deepEqual(
      decide(inert, { reversibility }),
      { disposition: 'blocking', reason: 'warranted', override: null, override_source: null, gate_failures: [] },
      `${reversibility} with no live impact`
    );
  }

  for (const reversibility of ['reversible', 'unknown', undefined]) {
    assert.equal(decide(bounded, { reversibility }).reason, 'safely-bounded', `${reversibility} bounded`);
    assert.equal(decide(inert, { reversibility }).reason, 'no-live-impact', `${reversibility} inert`);
  }
});

test('a one-way door still yields to the provenance rows, which are not about boundability', () => {
  const oneWayDoor = { reversibility: 'irreversible_without_cleanup' };

  assert.equal(decide({ authorship: 'pre_existing', boundable_by_followup: true }, oneWayDoor).reason, 'pre-existing');
  assert.equal(decide({ ...NOT_A_SHIPPED_PATH_BREAKAGE, precedent_count: 2 }, oneWayDoor).reason, 'policy-change');
  assert.throws(() => decide({}, { reversibility: 'mostly' }), /Unknown reversibility: mostly/);
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
  assert.throws(() => decide({ round: 0 }), /round must be a positive integer/);
  assert.throws(() => decide({ round: 2.5 }), /round must be a positive integer/);
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
    JSON.stringify({
      finding: finding(),
      answers: warrantedAnswers({ ...NOT_A_SHIPPED_PATH_BREAKAGE, induced_by_prior_suggestion: true }),
    })
  );
  const output = execFileSync('node', [join(scriptDir, 'blocking-gate.mjs'), inputPath], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), {
    disposition: 'follow_up',
    reason: 'induced-scope',
    override: null,
    override_source: null,
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

// The clearance round 1 of #1702 wrote, which round 3 reversed by hand because the marker carried
// no record of it. Rounds carry it forward for the life of the PR.
const ROUND_1_CLEARANCE = {
  claim: 'Forward compatibility with the closed block union',
  concern_id: 'reversibility-and-one-way-door',
  reason: 'Documented contract; eleven prior block types.',
};

const CONFIRMED_WARRANTED = [
  { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'The fixture finding is evidenced.' },
  { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'The fixture finding warrants gate evaluation.' },
];

function reportFor(round, dispositions, carried, cleared) {
  return {
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: `${round}`.repeat(40).slice(0, 40),
    round,
    cleared,
    findings: [...dispositions, ...carried].map(({ finding, disposition }) => ({
      id: finding.finding_id,
      disposition,
      severity: finding.severity,
      concern_id: finding.concern_id,
      title: `${finding.finding_id} at round ${round}`,
      problem: `What ${finding.finding_id} reports at round ${round}.`,
      suggested_action: `What to do about ${finding.finding_id}.`,
      ...(disposition === 'follow_up'
        ? {
            owner: 'maintainer',
          }
        : {}),
    })),
  };
}

// The gate decides, the renderer publishes, and the next round reads its own round number and
// clearance record back out of the marker rather than being told them. Round 3 of #1702 reversed a
// round 1 clearance because that record did not exist, and nothing else asserts the whole seam.
test('the #1702 rounds publish as mergeable and carry round 1 clearance to round 3', () => {
  const published = [];
  let priorState = null;
  let pool = [];

  for (const round of PR_1702) {
    const derivedRound = priorState === null ? 1 : priorState.round + 1;
    assert.equal(derivedRound, round.round, 'the round is read back out of the prior marker');

    const decided = round.proposed_blockers.map((entry) => {
      const result = advanceReviewPolicy({
        finding: entry.finding,
        verdicts: CONFIRMED_WARRANTED,
        gate_answers: entry.answers,
      });
      assert.equal(result.status, 'final');
      return { finding: result.finding, disposition: result.decision.disposition };
    });
    // A follow-up the author resolved between rounds leaves; the fixture records how many of
    // #1702's survived, most recent first.
    const carried = pool.slice(0, round.carried_follow_ups);

    const body = renderReviewReport(reportFor(derivedRound, decided, carried, [ROUND_1_CLEARANCE]));
    const state = parseReviewState(body);
    assert.ok(state, `round ${round.round} publishes a readable marker`);

    published.push({
      round: state.round,
      mergeable: body.startsWith('No blocking issues. This PR is mergeable.'),
      blocking: state.blocking_findings.length,
      deferred: state.deferred.map(({ id }) => id),
      cleared: state.cleared.map(({ claim }) => claim),
    });

    pool = [...decided, ...carried]
      .filter(({ disposition }) => disposition === 'follow_up')
      .map(({ finding }) => ({ finding, disposition: 'follow_up' }));
    priorState = state;
  }

  assert.deepEqual(published, [
    {
      round: 1,
      mergeable: true,
      blocking: 0,
      deferred: ['ACK-1702-1', 'DOC-1702-1'],
      cleared: [ROUND_1_CLEARANCE.claim],
    },
    { round: 2, mergeable: true, blocking: 0, deferred: ['CONV-1702-1'], cleared: [ROUND_1_CLEARANCE.claim] },
    {
      round: 3,
      mergeable: true,
      blocking: 0,
      deferred: ['RWD-1702-1', 'CONV-1702-1'],
      cleared: [ROUND_1_CLEARANCE.claim],
    },
  ]);
});
