import assert from 'node:assert/strict';
import test from 'node:test';
import { findTable } from './registry-table.mjs';

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
