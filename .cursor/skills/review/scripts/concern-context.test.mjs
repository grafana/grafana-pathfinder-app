import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReviewPlan, extractConcernContext, validateConcernRegistry } from './concern-context.mjs';

const concernsPath = fileURLToPath(new URL('../../../../docs/design/CONCERNS.md', import.meta.url));
const concernDetailsPath = fileURLToPath(new URL('../../../../docs/design/CONCERN_DETAILS.md', import.meta.url));
const skillPath = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const scriptsPath = fileURLToPath(new URL('.', import.meta.url));
const concerns = readFileSync(concernsPath, 'utf8');
const concernDetails = readFileSync(concernDetailsPath, 'utf8');

test('joins routing and review guidance into one concern packet', () => {
  const context = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'security',
  });

  assert.equal(context.id, 'security');
  assert.equal(context.category, 'always-on');
  assert.equal(context.activation.mode, 'always');
  assert.equal(context.activation.max_context_files, 8);
  assert.ok(context.trigger_paths.includes('src/security/**'));
  assert.match(context.purpose, /Protect the plugin from XSS/);
  assert.ok(context.related.includes('docs-retrieval-and-rendering'));
});

test('includes the concern anchor and named invariants', () => {
  const context = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'completion-records',
  });

  assert.equal(context.contract_anchor.evidence, '#1411 → #1700');
  assert.equal(context.named_invariants.length, 7);
  assert.equal(context.named_invariants[0].name, 'payload-boundary-normalization');
});

test('records the review orchestration contract under ai-subsystem', () => {
  const context = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'ai-subsystem',
  });

  assert.equal(context.contract_anchor.evidence, '#1711 → #1721');
  assert.match(context.contract_anchor.contract, /docs\/design\/PR_REVIEW\.md/);
  assert.match(context.contract_anchor.contract, /\.cursor\/skills\/review\/SKILL\.md/);
  assert.match(context.contract_anchor.contract, /review-report\.mjs/);
  assert.match(context.contract_anchor.contract, /concern-context\.mjs/);
  assert.match(context.contract_anchor.contract, /review-policy\.mjs/);
  assert.match(context.contract_anchor.contract, /30,000 characters/);
  assert.match(context.contract_anchor.contract, /Version 1 remains read-compatible/);
});

test('routes shared CLI and MCP command-contract changes to both owners', () => {
  const cli = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'cli-and-e2e-runner',
  });
  const mcp = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'mcp-authoring-server',
  });

  assert.ok(cli.trigger_keywords.includes('defineCommand'));
  assert.ok(cli.trigger_keywords.includes('CommandSpec'));
  assert.ok(cli.trigger_keywords.includes('COMMAND_MANIFEST'));
  assert.ok(mcp.trigger_keywords.includes('bindCommandInterface'));
  assert.ok(mcp.trigger_keywords.includes('defineCommand'));
  assert.ok(mcp.trigger_keywords.includes('CommandSpec'));
});

test('preserves grammatical commas in reviewer code scopes', () => {
  const ai = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'ai-subsystem',
  });
  const performance = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'performance-and-bundle',
  });

  assert.deepEqual(ai.load_code, [
    'changed agent-facing docs and rules only',
    'directly related skill, rule, or prompt files',
  ]);
  assert.deepEqual(performance.load_code, ['changed files adding monitoring, async fetches, or heavy imports']);
});

test('validates cross-table IDs and references', () => {
  assert.deepEqual(validateConcernRegistry({ routingMarkdown: concerns, detailMarkdown: concernDetails }), []);
});

test('rejects routing values outside the registry schema', () => {
  const invalid = concerns.replace(
    '| `security` | AO | Y | always | 1 | 8 |',
    '| `security` | invalid | Y | always | 0 | 99 |'
  );

  assert.deepEqual(validateConcernRegistry({ routingMarkdown: invalid, detailMarkdown: concernDetails }), [
    'Unknown category invalid for security',
    'min_signals must be between 1 and 8 for security',
    'max_context_files must be between 1 and 8 for security',
  ]);
});

test('rejects blank trigger keywords for conditional concerns', () => {
  for (const id of ['context-engine', 'analytics-and-telemetry']) {
    const row = concerns.split('\n').find((line) => line.startsWith(`| \`${id}\` |`));
    assert.ok(row);
    const keywordsStart = row.lastIndexOf(' | ');
    const invalid = concerns.replace(row, `${row.slice(0, keywordsStart)} | |`);

    assert.deepEqual(validateConcernRegistry({ routingMarkdown: invalid, detailMarkdown: concernDetails }), [
      `trigger_keywords must not be empty for ${id}`,
    ]);
  }
});

test('rejects duplicate contract owners and invariant names', () => {
  const lines = concernDetails.split('\n');
  const anchor = lines.find((line) => line.startsWith('| `completion-records` | #1411'));
  const candidate = lines.find((line) => line.startsWith('| `analytics-and-telemetry` | Accreting'));
  const invariant = lines.find((line) => line.startsWith('| `payload-boundary-normalization` |'));
  assert.ok(anchor && candidate && invariant);

  const invalid = concernDetails
    .replace(anchor, `${anchor}\n${anchor}`)
    .replace(candidate, `${candidate}\n${candidate}`)
    .replace(invariant, `${invariant}\n${invariant}`);

  assert.deepEqual(validateConcernRegistry({ routingMarkdown: concerns, detailMarkdown: invalid }), [
    'Duplicate contract anchor: completion-records',
    'Duplicate pre-contract candidate: analytics-and-telemetry',
    'Duplicate named invariant: payload-boundary-normalization',
  ]);
});

test('rejects blank required concern guidance', () => {
  const invalid = concernDetails.replace(
    'Protect the plugin from XSS, unsafe URL handling, insecure DOM APIs, unsafe HTML rendering, and other trust-boundary mistakes.',
    ''
  );

  assert.deepEqual(validateConcernRegistry({ routingMarkdown: concerns, detailMarkdown: invalid }), [
    'Missing purpose for security',
  ]);
});

test('keeps the always-loaded routing registry within its context budget', () => {
  assert.ok(Buffer.byteLength(concerns) < 25_000);
  assert.ok(Buffer.byteLength(concerns) + Buffer.byteLength(readFileSync(skillPath, 'utf8')) < 40_000);
});

test('keeps only the five agent-facing review executables', () => {
  const executables = readdirSync(scriptsPath)
    .filter(
      (name) =>
        name.endsWith('.mjs') &&
        !name.endsWith('.test.mjs') &&
        readFileSync(`${scriptsPath}/${name}`, 'utf8').includes('process.argv[1] === fileURLToPath(import.meta.url)')
    )
    .sort();
  assert.deepEqual(executables, [
    'concern-context.mjs',
    'contract-evolution-gate.mjs',
    'contract-evolution-policy.mjs',
    'review-policy.mjs',
    'review-report.mjs',
  ]);
});

test('emits every completion-records doc as one loadable path', () => {
  const context = extractConcernContext({
    routingMarkdown: concerns,
    detailMarkdown: concernDetails,
    concern: 'completion-records',
  });

  assert.deepEqual(context.load_docs, [
    'docs/design/BACKEND_PROXY_PATTERN.md',
    '.cursor/rules/systemPatterns.mdc (tier-1 lib/ guide-stats bullet)',
    'docs/developer/STEP_MODEL.md',
  ]);
  for (const doc of context.load_docs) {
    assert.doesNotMatch(doc, /`/);
    assert.ok(existsSync(fileURLToPath(new URL(`../../../../${doc.split(' ')[0]}`, import.meta.url))), doc);
  }
});

test('full routing keeps concern coverage inside three workers and both context envelopes', () => {
  const shared = { path: 'src/example.ts', excerpt: 'x'.repeat(4_000) };
  const plan = buildReviewPlan({
    mode: 'full',
    skeptic_batch_count: 2,
    concerns: [
      { id: 'correctness-and-reliability', context: [shared] },
      { id: 'testing-and-verification', context: [shared] },
      { id: 'security', specialist: 'security', context: [{ path: 'src/security.ts', excerpt: 'safe' }] },
      { id: 'cross-cutting-architecture', context: [{ path: 'src/other.ts', excerpt: 'boundary' }] },
    ],
    contract_evolution: {
      concern_id: 'ai-subsystem',
      context: [{ path: 'docs/design/PR_REVIEW.md', excerpt: 'contract' }],
    },
  });

  assert.equal(plan.workers.length, 3);
  assert.equal(plan.workers.filter(({ kind }) => kind === 'general' || kind === 'security').length, 2);
  assert.ok(plan.workers.every(({ files, context_characters }) => files.length <= 8 && context_characters <= 30_000));
  assert.ok(
    ['security', 'correctness-and-reliability', 'testing-and-verification', 'cross-cutting-architecture'].every(
      (id) => plan.coverage[id]
    )
  );
  assert.equal(plan.debug.worker_count, 3);
  assert.equal(plan.debug.skeptic_batch_count, 2);
  assert.equal(plan.coverage['contract-evolution:ai-subsystem'], 'contract-evolution');
});

test('incremental routing uses one general worker, one conditional specialist, and root overflow', () => {
  const packet = (id, index) => ({
    id,
    context: Array.from({ length: 8 }, (_, file) => ({
      path: `src/${index}-${file}.ts`,
      excerpt: 'x'.repeat(2_000),
    })),
  });
  const plan = buildReviewPlan({
    mode: 'incremental',
    concerns: [packet('correctness-and-reliability', 1), packet('testing-and-verification', 2)],
    contract_evolution: {
      concern_id: 'ai-subsystem',
      context: [{ path: 'docs/design/PR_REVIEW.md', excerpt: 'contract' }],
    },
  });

  assert.equal(plan.workers.length, 2);
  assert.deepEqual(plan.root.concern_ids, ['testing-and-verification']);
  assert.equal(plan.coverage['correctness-and-reliability'], 'general-1');
  assert.equal(plan.coverage['testing-and-verification'], 'root');
});

test('a packet above eight files or 30,000 characters stays with the root synthesizer', () => {
  const tooManyFiles = Array.from({ length: 9 }, (_, index) => ({ path: `src/${index}.ts`, excerpt: 'x' }));
  const tooManyCharacters = [{ path: 'src/large.ts', excerpt: 'x'.repeat(30_001) }];
  const plan = buildReviewPlan({
    mode: 'full',
    concerns: [
      { id: 'security', context: tooManyFiles },
      { id: 'correctness-and-reliability', context: tooManyCharacters },
    ],
  });

  assert.equal(plan.workers.length, 0);
  assert.deepEqual(plan.root.concern_ids, ['security', 'correctness-and-reliability']);
});
