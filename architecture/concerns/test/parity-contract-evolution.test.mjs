import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cliJson, readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';
import { LEGACY_GATE, legacyJson, runLegacy } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const HEAD = git(['rev-parse', 'HEAD'], REPOSITORY_ROOT);
// CI checks out at depth 1, where HEAD~1 does not resolve. The gate accepts
// base === head: it is an ancestor of itself and the in-stack range is empty,
// which is all the pathspec assertions below need from real history.
const BASE = HEAD;

function selectorsOf(concern) {
  return concern.activation.kind === 'always' ? concern.activation.context_selectors : concern.activation.selectors;
}

// The gate turns each backticked routing path into a Git pathspec, globbing the
// wildcards. Deriving the same list from the registry is what a Phase 4 gate
// would do once the Markdown is gone.
function registryPathspecs(concern) {
  return selectorsOf(concern)
    .paths.filter((selector) => selector.kind === 'glob' || selector.kind === 'literal_path')
    .map((selector) => (selector.kind === 'glob' ? `:(glob)${selector.pattern}` : selector.path));
}

function runGate(concern, options = {}) {
  return legacyJson(
    LEGACY_GATE,
    ['--base', options.base ?? BASE, '--head', options.head ?? HEAD, '--concern', concern, '--window-days', '1'],
    options
  );
}

test('the registry derives the same Git pathspecs the contract-evolution gate extracts', () => {
  let compared = 0;
  for (const concern of registry.concerns) {
    const derived = registryPathspecs(concern);
    const gate = runGate(concern.id);
    if (derived.length === 0) {
      assert.equal(gate.code, 2, `${concern.id} should be refused for having no concrete paths`);
      assert.match(gate.stderr, /has no concrete trigger paths/);
      continue;
    }
    assert.equal(gate.code, 0, `${concern.id}: ${gate.stderr}`);
    assert.deepEqual(gate.payload.paths, derived, `${concern.id} pathspecs`);
    compared += 1;
  }
  assert.ok(compared >= 25, `only ${compared} concerns carried concrete paths`);
});

// Equality is not available: the gate CLI has no notion of always-on
// suppression, so the registry marks every always-on concern ineligible through
// dispatch_policy.skips_always_on while the gate still serves them. The subset,
// plus the always-on carve-out below, is the whole of the shared claim.
test('every concern the gate refuses is one the registry already marks ineligible', () => {
  const refusedByGate = registry.concerns
    .filter((concern) => registryPathspecs(concern).length === 0)
    .map((concern) => concern.id);
  const ineligibleByRegistry = registry.concerns
    .filter((concern) => !cliJson(['show', concern.id, '--view', 'plan']).payload.concern.contract_evolution_eligible)
    .map((concern) => concern.id);
  for (const id of refusedByGate) {
    assert.ok(ineligibleByRegistry.includes(id), `${id} is refused by the gate but eligible in the registry`);
  }
  assert.deepEqual(
    ineligibleByRegistry.filter((id) => !refusedByGate.includes(id)).sort(),
    registry.concerns
      .filter((concern) => concern.activation.kind === 'always')
      .map((concern) => concern.id)
      .filter((id) => !refusedByGate.includes(id))
      .sort(),
    'the only concerns ineligible without being refused are the always-on ones the gate cannot see'
  );
  const gatePolicy = registry.dispatch_policy.contract_evolution_gate;
  assert.equal(gatePolicy.requires_concrete_path_selectors, true);
  assert.equal(gatePolicy.skips_always_on, true);
});

function writeRoutingMarkdown(root, rows) {
  mkdirSync(join(root, 'docs', 'design'), { recursive: true });
  const table = [
    '| id | cat | on | mode | min | max | trigger_paths | trigger_keywords |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
  writeFileSync(join(root, 'docs', 'design', 'CONCERNS.md'), `# Review concerns\n\n${table}\n`);
}

function commit(root, message) {
  git(['add', '-A'], root);
  git(['-c', 'commit.gpgsign=false', 'commit', '-m', message], root);
  return git(['rev-parse', 'HEAD'], root);
}

function temporaryRepository() {
  const root = mkdtempSync(join(tmpdir(), 'concern-gate-'));
  git(['init', '-q', '-b', 'main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  return root;
}

// PR #1733 moved the gate from reading CONCERNS.md at the base commit to reading
// it at head, so a concern row added inside the stack is now visible to its own
// gate run. Phase 4 has to preserve that, and the assertion below is what a
// regression would trip over.
test('the gate reads the routing table from head, so a row added in the stack is visible', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const row = '| `new-concern` | sub | N | strong | 2 | 8 | `src/new/**` | `newSymbol` |';
  writeRoutingMarkdown(root, ['| `existing` | sub | N | strong | 2 | 8 | `src/existing/**` | `oldSymbol` |']);
  const base = commit(root, 'base without the concern');
  writeRoutingMarkdown(root, ['| `existing` | sub | N | strong | 2 | 8 | `src/existing/**` | `oldSymbol` |', row]);
  const head = commit(root, 'head adds the concern');

  const added = runGate('new-concern', { base, head, cwd: root });
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual(added.payload.paths, [':(glob)src/new/**']);

  const removedAtHead = runGate('existing', { base, head, cwd: root });
  assert.equal(removedAtHead.code, 0, removedAtHead.stderr);
});

test('a concern present only at base is invisible to the gate, proving it does not read base', (t) => {
  const root = temporaryRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeRoutingMarkdown(root, ['| `retired` | sub | N | strong | 2 | 8 | `src/retired/**` | `goneSymbol` |']);
  const base = commit(root, 'base carries the concern');
  writeRoutingMarkdown(root, ['| `kept` | sub | N | strong | 2 | 8 | `src/kept/**` | `keptSymbol` |']);
  const head = commit(root, 'head drops the concern');

  const result = runGate('retired', { base, head, cwd: root });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /is not present in the routing table/);
});

test('the gate rejects revisions and concern ids that are not literal', () => {
  const injected = runLegacy(LEGACY_GATE, ['--base', 'HEAD~1', '--head', HEAD, '--concern', 'go-backend']);
  assert.equal(injected.code, 2);
  assert.match(injected.stderr, /literal Git commit SHAs/);
  const badConcern = runLegacy(LEGACY_GATE, ['--base', BASE, '--head', HEAD, '--concern', '../etc']);
  assert.equal(badConcern.code, 2);
});
