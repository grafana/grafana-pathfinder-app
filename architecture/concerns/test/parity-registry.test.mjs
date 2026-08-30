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

// Both Markdown registries are pinned line by line, because the registry
// translates far more of them than the five concern tables: the
// change-classification and routing-defaults tables, the classification,
// signal-counting, coverage-gap, rule-source, extraction and authoring
// paragraphs, the anchor, invariant and candidate policy prose, and both
// footnotes. Only presentation is left out — headings, blank lines, horizontal
// rules, code-fence markers, prettier-ignore directives and table delimiter
// rows. Cells and prose lines are compared by trimmed content, so reformatting
// does not trip the pin while any content change does.
const PINNED_MARKDOWN = [ROUTING_MARKDOWN, DETAIL_MARKDOWN];

function isPresentation(line) {
  const trimmed = line.trim();
  return (
    trimmed === '' ||
    trimmed === '---' ||
    trimmed === '<!-- prettier-ignore -->' ||
    trimmed.startsWith('```') ||
    /^#{1,6} /.test(trimmed) ||
    /^\|[\s|:-]+\|$/.test(trimmed)
  );
}

function normalizeLine(line) {
  return line.startsWith('|')
    ? line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
        .join('\x1f')
    : line.trim();
}

function pinnedContent(path) {
  return markdown(path)
    .split('\n')
    .filter((line) => !isPresentation(line))
    .map(normalizeLine);
}

// The pin forces a re-reconciliation; these compare the translation itself, so a
// changed sentence has to disagree with the field it was translated into rather
// than only move the digest.
function sectionLines(path, heading) {
  const lines = markdown(path).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.notEqual(start, -1, `${path} has no section ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /.test(line.trim()));
  return end === -1 ? rest : rest.slice(0, end);
}

function sectionProse(path, heading) {
  return sectionLines(path, heading).filter((line) => !isPresentation(line) && !line.startsWith('|'));
}

// Pinning the covered line count is what stops the pin being quietly narrowed
// again: dropping a translated line, or adding one without reconciling it, moves
// this number as well as the digest.
const PINNED_LINE_COUNTS = [
  [ROUTING_MARKDOWN, 50],
  [DETAIL_MARKDOWN, 65],
];

const TRANSLATED_REGIONS = [
  [ROUTING_MARKDOWN, '## Change classification'],
  [ROUTING_MARKDOWN, '## Routing defaults'],
  [ROUTING_MARKDOWN, '## Coverage-gap detection'],
  [ROUTING_MARKDOWN, '## Canonical rule sources'],
  [ROUTING_MARKDOWN, '## Concern routing table'],
  [ROUTING_MARKDOWN, '## Concern details'],
  [DETAIL_MARKDOWN, '## Concern review table'],
  [DETAIL_MARKDOWN, '## Contract anchors'],
  [DETAIL_MARKDOWN, '### Named invariants'],
  [DETAIL_MARKDOWN, '### Pre-contract candidates'],
  [DETAIL_MARKDOWN, '## Footnotes'],
];

test('the pin covers every translated region and not only the concern tables', () => {
  for (const [path, expected] of PINNED_LINE_COUNTS) {
    assert.equal(pinnedContent(path).length, expected, `${path} no longer pins the same number of content lines`);
  }
  for (const [path, heading] of TRANSLATED_REGIONS) {
    const pinned = new Set(pinnedContent(path));
    const lines = sectionLines(path, heading).filter((line) => !isPresentation(line));
    assert.ok(lines.length > 0, `${path} ${heading} contributes nothing to the pin`);
    for (const line of lines) {
      assert.ok(pinned.has(normalizeLine(line)), `${path} ${heading} is outside the pin: ${line}`);
    }
  }
});

test('the Markdown registries are pinned to the content the registry was translated from', () => {
  const digest = createHash('sha256');
  for (const path of PINNED_MARKDOWN) {
    digest.update(`${path}\x1d`);
    for (const line of pinnedContent(path)) {
      digest.update(`${line}\x1e`);
    }
  }
  assert.equal(
    digest.digest('hex').slice(0, 16),
    '9870543ffcb243c3',
    'a Markdown registry changed a table cell or a translated sentence: re-run the registry parity reconciliation and update this pin in the same change'
  );
});

test('the change classification table is exactly the registry change class list', () => {
  const rows = tableRows(markdown(ROUTING_MARKDOWN), ['class', 'description']);
  assert.deepEqual(
    rows.map((row) => ({ id: bare(row.class), description: row.description })),
    registry.change_classes.map(({ id, description }) => ({ id, description }))
  );
  const prose = sectionProse(ROUTING_MARKDOWN, '## Change classification');
  assert.equal(prose[0], 'Classify PRs into one or more of these classes before routing:');
  assert.equal(registry.classification_policy.classify_before_routing, true);
  assert.equal(registry.classification_policy.multiple_classes_permitted, true);
});

test('the routing defaults table is exactly the registry category defaults', () => {
  const rows = tableRows(markdown(ROUTING_MARKDOWN), ['category', 'mode', 'min_signals', 'max_context_files']);
  assert.deepEqual(
    rows.map((row) => ({
      category: row.category.replace(/\s*\(`[^`]+`\)$/, ''),
      abbreviation: row.category.match(/\(`([^`]+)`\)/)[1],
      mode: bare(row.mode),
      min: Number(row.min_signals),
      max: Number(row.max_context_files),
    })),
    registry.category_defaults.categories.map((entry) => ({
      category: entry.category,
      abbreviation: entry.source_abbreviation,
      mode: entry.mode,
      min: entry.default_minimum_signals,
      max: entry.default_max_context_files,
    }))
  );
});

test('the fail-open and signal-counting sentences are exactly what the policy fields store', () => {
  const policy = registry.classification_policy;
  const classification = sectionProse(ROUTING_MARKDOWN, '## Change classification').at(-1);
  const stated = `${policy.fail_open_statement} ${policy.suppression_prohibition_statement}`;
  assert.equal(classification.slice(0, stated.length), stated, 'the fail-open paragraph is no longer what is stored');
  const remainder = classification.slice(stated.length).trim();
  for (const concern of policy.never_suppressed_concerns) {
    assert.ok(remainder.includes(concern), `${concern} is no longer named as always running`);
  }
  assert.equal(policy.final_cross_cutting_synthesis_always_runs, remainder.includes('always run'));
  for (const domain of policy.suppression_prohibited_domains) {
    assert.ok(policy.suppression_prohibition_statement.includes(domain), `${domain} is not in the stored sentence`);
  }

  const signal = registry.signal_policy;
  assert.equal(
    sectionProse(ROUTING_MARKDOWN, '## Routing defaults').at(-1),
    `${signal.statement} ${signal.semantic_evidence_requirement.statement}`
  );
});

test('the coverage-gap paragraph is exactly what the coverage gap policy stores', () => {
  const policy = registry.coverage_gap_policy;
  const [first, ...rest] = policy.actions;
  const actions = [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest];
  assert.equal(
    sectionProse(ROUTING_MARKDOWN, '## Coverage-gap detection').at(-1),
    `${actions.slice(0, -1).join(', ')}, and ${actions.at(-1)} when: ${policy.conditions.join('; ')}. ${policy.suppression_prohibition_statement}`
  );
  assert.equal(policy.disposition, 'disclose');
  assert.equal(policy.is_gate, false);
});

test('the canonical rule sources paragraph is what rule_sources stores', () => {
  const [source] = registry.rule_sources;
  const paragraph = sectionProse(ROUTING_MARKDOWN, '## Canonical rule sources').at(-1);
  assert.ok(
    paragraph.startsWith(
      `${source.rule_ids[0]}–${source.rule_ids.at(-1)} security rules are defined in \`${source.intent_source}\`.`
    ),
    'the intent source or rule range changed'
  );
  assert.ok(paragraph.includes(source.enforced_syntax_statement), 'the enforced-syntax sentence changed');
  for (const document of source.referencing_documents) {
    assert.ok(paragraph.includes(`\`${document}\``), `${document} is no longer named as a referencing document`);
  }
  for (const entry of source.precedence) {
    assert.ok(paragraph.includes(`wins for ${entry.subject}`), `precedence for ${entry.subject} is no longer stated`);
  }
  assert.ok(paragraph.includes(`\`${source.enforced_syntax_source}\``), 'the enforced syntax source changed');
  assert.equal(source.referencing_documents_may_redefine, !paragraph.includes('without redefining them'));
});

test('the extraction and authoring prose is what the policy fields store', () => {
  const details = sectionLines(ROUTING_MARKDOWN, '## Concern details').filter((line) => line.trim() !== '');
  const extraction = registry.extraction_policy;
  assert.ok(
    details.some((line) => line.trim() === extraction.extractor_command),
    'the extractor command changed'
  );
  assert.ok(
    details.some((line) => line.includes(extraction.alignment_validation_command)),
    'the alignment validation command changed'
  );
  const packetSentence = details.find((line) => line.startsWith('The extractor joins'));
  for (const field of extraction.packet_fields) {
    assert.ok(packetSentence.includes(field), `${field} is no longer listed as a packet field`);
  }
  assert.equal(extraction.wholesale_load_permitted, false);
  assert.ok(details.some((line) => line.includes('Do not load that registry wholesale')));

  const authoring = registry.authoring_policy;
  const authoringSentence = details.at(-1);
  assert.ok(authoringSentence.startsWith('When authoring concerns, prefer editing an existing concern'));
  assert.equal(authoring.prefer_extending_existing, true);
  for (const evidence of authoring.add_concern_evidence) {
    assert.ok(authoringSentence.includes(evidence.replace(/^an? /, '')), `${evidence} is no longer required evidence`);
  }
});

test('the anchor, invariant and candidate policy prose is what the policy fields store', () => {
  const anchors = sectionProse(DETAIL_MARKDOWN, '## Contract anchors');
  assert.ok(anchors[0].startsWith(registry.contract_policy.definition), 'the anchor definition changed');
  assert.ok(anchors[0].includes(registry.contract_policy.scan_owner_document), 'the scan owner document changed');
  assert.deepEqual(
    anchors.filter((line) => line.startsWith('- ')).map((line) => line.slice(2)),
    registry.contract_policy.rules
  );

  const invariants = sectionProse(DETAIL_MARKDOWN, '### Named invariants');
  assert.ok(invariants[0].startsWith(registry.invariant_policy.definition), 'the invariant definition changed');
  assert.ok(invariants[0].includes(registry.invariant_policy.naming_rule), 'the invariant naming rule changed');

  const candidates = sectionProse(DETAIL_MARKDOWN, '### Pre-contract candidates');
  assert.ok(
    candidates[0].includes('advisory architecture hypotheses, not anchors.'),
    'the candidate definition changed'
  );
  assert.ok(candidates[0].includes(registry.candidate_policy.evolution_packet_flag.field), 'the packet flag changed');
  assert.equal(registry.candidate_policy.authorizes_blocking_conformance_finding, false);
});

test('both footnotes are represented by the typed values that replaced them', () => {
  const footnotes = sectionProse(DETAIL_MARKDOWN, '## Footnotes');
  const [related, reversibility] = footnotes;

  const crossCutting = registry.concerns.find((concern) => concern.id === 'cross-cutting-architecture');
  assert.ok(related.includes('cross-cutting-architecture'), 'footnote one no longer names the concern it replaced');
  assert.equal(crossCutting.related.kind, 'all_other_concerns');

  const reversible = registry.concerns.find((concern) => concern.id === 'reversibility-and-one-way-door');
  assert.ok(reversibility.includes('reversibility-and-one-way-door'));
  assert.deepEqual(
    [...reversibility.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]),
    reversible.output_policy.values
  );
});
