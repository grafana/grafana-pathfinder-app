import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReviewState, renderReviewReport } from './review-report.mjs';

test('ends with the PR URL, one-line purpose, verdict, and finding counts', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider\n guide blocks',
    reviewed_head: 'a'.repeat(40),
    findings: [],
  });

  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      'Verdict: Approve',
      '0 blocking, 0 suggestions, 0 nits',
    ].join('\n')
  );
});

test('renders the merge contract before optional findings and derives the verdict', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'b'.repeat(40),
    findings: [
      {
        id: 'N1',
        concern_id: 'documentation',
        disposition: 'nit',
        severity: 'low',
        title: 'Use sentence case',
        problem: 'The new heading uses title case.',
        suggested_action: 'Change the heading to sentence case.',
      },
      {
        id: 'B1',
        concern_id: 'reversibility-and-one-way-door',
        disposition: 'blocking',
        severity: 'high',
        title: 'Keep rollback readable',
        problem: 'Older readers reject the persisted block.',
        suggested_action: 'Define a downgrade-safe representation.',
      },
      {
        id: 'S1',
        concern_id: 'correctness-and-reliability',
        disposition: 'suggestion',
        severity: 'medium',
        title: 'Trim redundant comments',
        problem: 'Two comments restate their declarations.',
        suggested_action: 'Remove the comments.',
      },
    ],
  });

  assert.match(output, /Fix this item and this PR is mergeable\./);
  assert.ok(output.indexOf('[blocking]') < output.indexOf('[suggestion]'));
  assert.ok(output.indexOf('[suggestion]') < output.indexOf('[nit]'));
  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      'Verdict: Request Changes',
      '1 blocking, 1 suggestion, 1 nit',
    ].join('\n')
  );
});

test('embeds parseable re-review state before the final recap', () => {
  const reviewedHead = 'c'.repeat(40);
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: reviewedHead,
    findings: [
      {
        id: 'B1',
        concern_id: 'reversibility-and-one-way-door',
        disposition: 'blocking',
        severity: 'high',
        title: 'Keep rollback readable',
        problem: 'Older readers reject the persisted block.',
        suggested_action: 'Define a downgrade-safe representation.',
      },
    ],
  });

  assert.deepEqual(parseReviewState(output), {
    version: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'reversibility-and-one-way-door' }],
  });
  assert.ok(output.indexOf('pathfinder-review-state') < output.indexOf('PR Review:'));
});

test('rejects findings without an author disposition', () => {
  assert.throws(
    () =>
      renderReviewReport({
        pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
        pr_title: 'feat: add divider guide blocks',
        reviewed_head: 'd'.repeat(40),
        findings: [
          {
            id: 'Q1',
            concern_id: 'cross-cutting-architecture',
            disposition: 'question',
            severity: 'medium',
            title: 'Clarify the fallback',
            problem: 'The intended fallback is unclear.',
            suggested_action: 'State which behavior is required.',
          },
        ],
      }),
    /disposition must be blocking, suggestion, or nit/
  );
});
