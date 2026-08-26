import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractConcernContext, validateConcernRegistry } from './concern-context.mjs';

const concernsPath = fileURLToPath(new URL('../../../../docs/design/CONCERNS.md', import.meta.url));
const concernDetailsPath = fileURLToPath(new URL('../../../../docs/design/CONCERN_DETAILS.md', import.meta.url));
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
    'max_context_files must be between 1 and 20 for security',
  ]);
});

test('keeps the always-loaded routing registry within its context budget', () => {
  assert.ok(Buffer.byteLength(concerns) < 25_000);
});
