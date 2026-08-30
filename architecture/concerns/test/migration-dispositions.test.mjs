import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cliJson, readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';
import { LEGACY_REVIEW_POLICY, runLegacy } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);
const discrepancies = registry.migration_discrepancies;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

// Phase 1 recorded these conflicts and Phase 2 was forbidden to touch them.
// Phase 3 owns them: each one is either answered, or held open on purpose with a
// reason and an expiry. The list is spelled out rather than filtered, because
// Phase 3 may re-earmark a discrepancy to a later phase and that must not be a
// way for one to slip through undisposed.
const DEFERRED_TO_PHASE_3 = [
  'path-only-activation',
  'go-backend-continue-selector',
  'routing-defaults-versus-row-overrides',
  'legacy-unquote-mangling',
  'anchor-evidence-relation-unreviewed',
  'test-path-two-value-shapes',
  'reversibility-values-narrower-than-live-contract',
];

test('every discrepancy Phase 1 deferred to Phase 3 carries a Phase 3 disposition', () => {
  for (const id of DEFERRED_TO_PHASE_3) {
    const entry = discrepancies.find((candidate) => candidate.id === id);
    assert.ok(entry, `${id} is no longer in the registry`);
    assert.ok(entry.disposition, `${id} rode into Phase 4 without a disposition`);
    assert.equal(entry.disposition.decided_in, 'phase-3', id);
    assert.ok(entry.disposition.rationale.length > 40, `${id} needs a real rationale`);
  }
});

test('a resolved discrepancy cites evidence and a ratified one also carries an expiry', () => {
  for (const entry of discrepancies) {
    const disposition = entry.disposition;
    if (!disposition) {
      continue;
    }
    if (disposition.status === 'resolved') {
      assert.ok(disposition.evidence?.length > 0, `${entry.id} claims resolution without evidence`);
      assert.equal(disposition.expires_with, undefined, `${entry.id} is resolved, so nothing expires`);
    }
    if (disposition.status === 'ratified_exception') {
      assert.ok(disposition.evidence?.length > 0, `${entry.id} is ratified without evidence`);
      assert.ok(disposition.expires_with, `${entry.id} is ratified without an expiry`);
    }
    if (disposition.status === 'escalated') {
      assert.ok(disposition.escalation, `${entry.id} is escalated without naming the question`);
      assert.ok(disposition.escalation.options.length >= 2, entry.id);
      assert.ok(disposition.escalation.recommendation, `${entry.id} should carry a recommendation`);
    }
  }
});

test('every cited piece of evidence names a file that exists', () => {
  for (const entry of discrepancies) {
    for (const evidence of entry.disposition?.evidence ?? []) {
      const path = evidence.split(':')[0].trim();
      assert.ok(existsSync(join(REPOSITORY_ROOT, path)), `${entry.id} cites missing evidence ${path}`);
    }
  }
});

test('no discrepancy is left escalated', () => {
  const escalated = discrepancies.filter((entry) => entry.disposition?.status === 'escalated');
  assert.deepEqual(escalated, []);
});

// The approved plan reserves changes to what actually activates for the
// post-cutover alignment phase, so Phase 3 preserves behaviour and keeps the
// conflict disclosed. Routing must still say so on every run, and the signal
// policy must still call the requirement unresolved.
test('the activation conflict stays unresolved and disclosed on every route', () => {
  const entry = discrepancies.find((candidate) => candidate.id === 'path-only-activation');
  assert.equal(entry.resolution, 'unresolved');
  assert.equal(entry.resolve_in, 'post-cutover-alignment');
  assert.equal(entry.disposition.status, 'ratified_exception');
  assert.equal(entry.disposition.expires_with, 'post-cutover-alignment');
  assert.equal(entry.candidate_readings.length, 3, 'all three readings must stay on the record');

  const requirement = registry.signal_policy.semantic_evidence_requirement;
  assert.equal(requirement.status, 'unresolved');
  assert.equal(requirement.discrepancy_id, 'path-only-activation');

  const file = join(tmpdir(), 'concerns-disposition-route.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, paths: ['pkg/plugin/resources.go'] }));
  const routed = cliJson(['route', '--input', file]).payload;
  const disclosure = routed.disclosures.find((item) => item.kind === 'semantic_evidence_requirement');
  assert.ok(disclosure, 'routing must disclose the requirement it is applying');
  assert.equal(disclosure.discrepancy_id, 'path-only-activation');
  assert.equal(disclosure.status, 'unresolved');
  assert.ok(
    disclosure.path_only_candidates.includes('go-backend'),
    'a minimum_signals 1 concern matched on paths alone is exactly the case the conflict is about'
  );
});

// The ratification of test-path-two-value-shapes rests on this being true. If a
// value stops resolving, the exception is no longer safe to hold open.
test('every test_path verification value resolves to exactly one tracked file', () => {
  const tracked = trackedFiles();
  const values = registry.concerns.flatMap((concern) =>
    concern.guidance.verification.filter((step) => step.kind === 'test_path').map((step) => step.path)
  );
  assert.equal(values.length, 17);
  let rooted = 0;
  let byBasename = 0;
  for (const value of values) {
    if (tracked.includes(value)) {
      rooted += 1;
      continue;
    }
    const matches = tracked.filter((path) => path.endsWith(`/${value}`));
    assert.equal(matches.length, 1, `${value} resolves to ${matches.length} tracked files`);
    byBasename += 1;
  }
  assert.equal(rooted, 8);
  assert.equal(byBasename, 9);
});

test('no concern packet exposes anchor evidence relation semantics', () => {
  for (const id of ['interactive-engine', 'completion-records', 'cross-tab-controller']) {
    const packet = cliJson(['show', id, '--view', 'review']).payload.concern;
    if (packet.contract_anchor === null) {
      continue;
    }
    assert.deepEqual(Object.keys(packet.contract_anchor).sort(), ['contract', 'evidence']);
  }
});

function reviewPolicyVerdict(reversibility) {
  const input = join(tmpdir(), `concerns-reversibility-${reversibility}.json`);
  writeFileSync(
    input,
    JSON.stringify({
      round: 1,
      observation: {
        finding_id: 'reversibility-probe',
        concern_id: 'reversibility-and-one-way-door',
        kind: 'nit',
        severity: 'low',
        confidence: 'high',
        title: 'probe',
        evidence: ['probe'],
        why_it_matters: 'probe',
        suggested_action: 'probe',
        reversibility,
        applies_to_files: [],
        origin: 'regression',
        impact: 'none',
        timing: 'first_round',
        scope_effect: 'within_changed_surface',
        breaks_shipped_path: false,
        induced: false,
      },
    })
  );
  return runLegacy(LEGACY_REVIEW_POLICY, [input]);
}

// The disposition holding this discrepancy open rests on the live policy still
// accepting a fourth verdict, so the live policy is asked rather than read: the
// probe below fails the moment 'unknown' leaves its accepted set.
test('the reversibility output policy stays narrower than the live review contract', () => {
  const concern = registry.concerns.find((entry) => entry.id === 'reversibility-and-one-way-door');
  assert.deepEqual(concern.output_policy.values, [
    'reversible',
    'partially_reversible',
    'irreversible_without_cleanup',
  ]);
  const accepted = reviewPolicyVerdict('unknown');
  assert.equal(accepted.code, 0, `the live policy no longer accepts 'unknown': ${accepted.stderr}`);
  const rejected = reviewPolicyVerdict('not-a-verdict');
  assert.equal(rejected.code, 2, 'the probe must be able to observe a refusal at all');
  assert.match(rejected.stderr, /Unknown reversibility/);
  for (const value of concern.output_policy.values) {
    assert.equal(reviewPolicyVerdict(value).code, 0, `${value} must remain acceptable to the live policy`);
  }
});

// The registry-size question Phase 2 flagged. Pretty printing costs bytes on
// disk and buys a reviewable diff for a file whose whole job is human-reviewed
// architectural policy. Nothing pays that cost in tokens, because no consumer
// reads the registry: the CLI hands back bounded packets instead.
test('the registry stays pretty-printed and its size is not a consumer cost', () => {
  const text = readFileSync(REGISTRY_PATH, 'utf8');
  assert.ok(text.split('\n').length > 4000, 'the registry must stay line-diffable');
  assert.equal(text.endsWith('\n'), true);
  const compact = Buffer.byteLength(JSON.stringify(JSON.parse(text)), 'utf8');
  const pretty = Buffer.byteLength(text, 'utf8');
  assert.ok(pretty > compact, 'pretty printing is the deliberate choice being pinned here');
  const worker = Buffer.byteLength(JSON.stringify(cliJson(['show', 'security', '--view', 'worker']).payload), 'utf8');
  assert.ok(worker < compact / 20, `a worker packet is ${worker} bytes against a ${compact}-byte registry`);
});

// Selector repetition is intentional overlap between concerns, not redundancy to
// squeeze out; declaring it with rationale is named post-cutover work. Pinning
// the counts makes unplanned growth visible without freezing the registry.
test('selector repetition stays within the bounds Phase 3 measured', () => {
  const selectorsOf = (concern) =>
    concern.activation.kind === 'always' ? concern.activation.context_selectors : concern.activation.selectors;
  const paths = registry.concerns.flatMap((concern) =>
    selectorsOf(concern).paths.map((selector) => selector.pattern ?? selector.path ?? selector.source_text)
  );
  const semantics = registry.concerns.flatMap((concern) =>
    selectorsOf(concern).semantics.map((selector) => selector.value ?? selector.source_text)
  );
  assert.equal(paths.length, 168);
  assert.equal(new Set(paths).size, 136);
  assert.equal(semantics.length, 336);
  assert.equal(new Set(semantics).size, 315);
});
