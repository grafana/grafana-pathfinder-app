import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';
import { legacyPacket } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);
const ROUTING_MARKDOWN = 'docs/design/CONCERNS.md';
const DETAIL_MARKDOWN = 'docs/design/CONCERN_DETAILS.md';

function markdown(path) {
  return readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
}

// A deliberately independent table reader. Sharing the review skill's parser
// would make agreement a tautology, and the subproject may not import it anyway.
function tableRows(text, requiredHeaders) {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex(
    (line) =>
      line.startsWith('|') &&
      requiredHeaders.every((header) =>
        line
          .split('|')
          .map((cell) => cell.trim().toLowerCase())
          .includes(header)
      )
  );
  assert.notEqual(headerIndex, -1, `no table with headers ${requiredHeaders.join(', ')}`);
  const headers = lines[headerIndex]
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim().toLowerCase());
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = lines[index]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]])));
  }
  return rows;
}

function bare(value) {
  return value.replace(/^`|`$/g, '');
}

const routingRows = tableRows(markdown(ROUTING_MARKDOWN), ['id', 'trigger_paths', 'trigger_keywords']);
const detailRows = tableRows(markdown(DETAIL_MARKDOWN), ['id', 'purpose', 'review_questions']);
const anchorRows = tableRows(markdown(DETAIL_MARKDOWN), ['concern', 'anchor', 'contract']);
const invariantRows = tableRows(markdown(DETAIL_MARKDOWN), ['name', 'concern', 'invariant']);
const candidateRows = tableRows(markdown(DETAIL_MARKDOWN), ['concern', 'evidence', 'proposed owner']);

const CATEGORIES = { AO: 'always-on', sub: 'subsystem', xcut: 'cross-cutting' };

function selectorsOf(concern) {
  return concern.activation.kind === 'always' ? concern.activation.context_selectors : concern.activation.selectors;
}

test('the registry holds exactly the routing table ids, in the same order, with no rename', () => {
  assert.deepEqual(
    registry.concerns.map((concern) => concern.id),
    routingRows.map((row) => bare(row.id))
  );
  assert.equal(registry.concerns.length, 27);
});

test('every routing row column matches the typed registry record', () => {
  for (const row of routingRows) {
    const concern = registry.concerns.find((entry) => entry.id === bare(row.id));
    assert.ok(concern, bare(row.id));
    assert.equal(concern.activation.category, CATEGORIES[row.cat], `${concern.id} category`);
    assert.equal(concern.activation.mode, row.mode, `${concern.id} mode`);
    assert.equal(concern.activation.minimum_signals, Number(row.min), `${concern.id} min_signals`);
    assert.equal(concern.context_budget.max_context_files, Number(row.max), `${concern.id} max_context_files`);
    assert.equal(concern.activation.kind === 'always' ? 'Y' : 'N', row.on, `${concern.id} on`);
  }
});

// The Markdown cell is read the way the legacy parser reads it — split on
// commas — and each registry selector is rendered back to the source form it was
// translated from. Selector drift is the failure that would quietly change
// routing, so both directions are checked: nothing dropped, nothing invented.
function cellEntries(cell) {
  return cell
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toSourceForm(selector) {
  if (selector.kind === 'all_changed_files' || selector.kind === 'unresolved_selector') {
    return selector.source_text;
  }
  return `\`${selector.pattern ?? selector.path ?? selector.value}\``;
}

test('every trigger path and keyword in the Markdown survives into the registry and no others appear', () => {
  for (const row of routingRows) {
    const concern = registry.concerns.find((entry) => entry.id === bare(row.id));
    const selectors = selectorsOf(concern);
    assert.deepEqual(selectors.paths.map(toSourceForm), cellEntries(row.trigger_paths), `${concern.id} trigger_paths`);
    assert.deepEqual(
      selectors.semantics.map(toSourceForm),
      cellEntries(row.trigger_keywords),
      `${concern.id} trigger_keywords`
    );
  }
});

// The one selector the translation could not resolve is the one the registry
// records as a discrepancy. Any second unresolved selector would be a new,
// unrecorded ambiguity.
test('the registry carries exactly one unresolved selector and it is the recorded one', () => {
  const unresolved = registry.concerns.flatMap((concern) =>
    selectorsOf(concern)
      .semantics.filter((selector) => selector.kind === 'unresolved_selector')
      .map((selector) => ({ concern: concern.id, selector }))
  );
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].concern, 'go-backend');
  assert.equal(unresolved[0].selector.discrepancy_id, 'go-backend-continue-selector');
  assert.deepEqual(unresolved[0].selector.candidate_values, ['continue', 'continue token']);
});

test('the detail table supplies a record for every routing id and nothing extra', () => {
  assert.deepEqual(detailRows.map((row) => bare(row.id)).sort(), registry.concerns.map((concern) => concern.id).sort());
  for (const row of detailRows) {
    const concern = registry.concerns.find((entry) => entry.id === bare(row.id));
    assert.equal(concern.guidance.purpose, row.purpose, `${concern.id} purpose`);
  }
});

test('every contract anchor, named invariant, and pre-contract candidate is represented once', () => {
  for (const row of anchorRows) {
    const concern = registry.concerns.find((entry) => entry.id === bare(row.concern));
    assert.ok(concern, `anchor for unknown concern ${row.concern}`);
    const established = concern.contract_records.filter((record) => record.kind === 'established');
    assert.equal(established.length, 1, `${concern.id} established records`);
    assert.equal(established[0].evidence.display_text, row.anchor, `${concern.id} anchor evidence`);
  }
  for (const row of candidateRows) {
    const concern = registry.concerns.find((entry) => entry.id === bare(row.concern));
    const candidates = concern.contract_records.filter((record) => record.kind === 'candidate');
    assert.equal(candidates.length, 1, `${concern.id} candidate records`);
    assert.equal(candidates[0].evidence.display_text, row.evidence, `${concern.id} candidate evidence`);
  }
  const registryInvariants = registry.concerns
    .flatMap((concern) => concern.named_invariants.map((invariant) => `${concern.id}:${invariant.name}`))
    .sort();
  assert.deepEqual(registryInvariants, invariantRows.map((row) => `${bare(row.concern)}:${bare(row.name)}`).sort());
});

test('the independent reader agrees with the extractor the review skill actually runs', () => {
  for (const row of routingRows.slice(0, 5)) {
    const id = bare(row.id);
    const packet = legacyPacket(id);
    assert.equal(packet.id, id);
    assert.equal(packet.activation.min_signals, Number(row.min));
  }
});

// The registry was translated from the content of these five tables. If any row
// moves, the translation has to be re-reconciled rather than assumed still
// current. Prose outside the tables is not part of the translation, so it is not
// part of the pin.
const PINNED_TABLES = [
  ['routing', routingRows],
  ['details', detailRows],
  ['anchors', anchorRows],
  ['invariants', invariantRows],
  ['candidates', candidateRows],
];

function tableDigest() {
  const digest = createHash('sha256');
  for (const [name, rows] of PINNED_TABLES) {
    digest.update(`${name}\x1d`);
    for (const row of rows) {
      for (const header of Object.keys(row).sort()) {
        digest.update(`${header}\x1f${row[header] ?? ''}\x1f`);
      }
      digest.update('\x1e');
    }
  }
  return digest.digest('hex').slice(0, 16);
}

test('the Markdown registry tables are pinned to the content the registry was translated from', () => {
  assert.equal(
    tableDigest(),
    'd53f8e2ab7cc975e',
    'a Markdown registry table changed: re-run the registry parity reconciliation and update this pin in the same change'
  );
});
