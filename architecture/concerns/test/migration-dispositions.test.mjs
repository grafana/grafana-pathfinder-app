import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cliJson, readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';

const registry = readJson(REGISTRY_PATH);
const discrepancies = registry.migration_discrepancies;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

// Phase 1 recorded these conflicts and Phase 2 was forbidden to touch them.
// Phase 3 owns them: each one is either answered, or held open on purpose with a
// reason and an expiry, or named as a decision somebody above this code must make.
test('every discrepancy Phase 1 deferred to Phase 3 carries a Phase 3 disposition', () => {
  const deferred = discrepancies.filter((entry) => entry.resolve_in === 'phase-3');
  assert.equal(deferred.length, 7);
  for (const entry of deferred) {
    assert.ok(entry.disposition, `${entry.id} rode into Phase 4 without a disposition`);
    assert.equal(entry.disposition.decided_in, 'phase-3', entry.id);
    assert.ok(entry.disposition.rationale.length > 40, `${entry.id} needs a real rationale`);
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

test('exactly one discrepancy is escalated, and it is the activation conflict', () => {
  const escalated = discrepancies.filter((entry) => entry.disposition?.status === 'escalated');
  assert.deepEqual(
    escalated.map((entry) => entry.id),
    ['path-only-activation']
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

test('the reversibility output policy stays narrower than the live review contract', () => {
  const concern = registry.concerns.find((entry) => entry.id === 'reversibility-and-one-way-door');
  assert.deepEqual(concern.output_policy.values, [
    'reversible',
    'partially_reversible',
    'irreversible_without_cleanup',
  ]);
  const livePolicy = readFileSync(join(REPOSITORY_ROOT, '.cursor/skills/review/scripts/review-policy.mjs'), 'utf8');
  assert.match(livePolicy, /unknown/, 'the live policy still accepts a verdict the registry does not list');
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
