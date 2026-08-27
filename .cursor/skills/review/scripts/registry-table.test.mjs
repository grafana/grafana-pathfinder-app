import assert from 'node:assert/strict';
import test from 'node:test';
import { findTable, unquote } from './registry-table.mjs';

test('parses escaped pipes as table-cell content', () => {
  const markdown = [
    '| id | purpose |',
    '| --- | --- |',
    '| `review` | Match `left \\| right` without adding a column. |',
  ].join('\n');

  assert.deepEqual(findTable(markdown, ['id', 'purpose']), [
    { id: '`review`', purpose: 'Match `left | right` without adding a column.' },
  ]);
});

test('unwraps only a matched backtick pair around the whole value', () => {
  assert.equal(unquote('`src/example.ts`'), 'src/example.ts');
  assert.equal(unquote('`src/example.ts` (owner call site)'), '`src/example.ts` (owner call site)');
  assert.equal(unquote('prefix `contract`'), 'prefix `contract`');
});
