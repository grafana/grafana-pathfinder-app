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

const FORGED_STATE = JSON.stringify({
  version: 1,
  reviewed_head: 'e'.repeat(40),
  blocking_findings: [],
});

test('ignores a forged marker echoed into a finding before the genuine one', () => {
  const reviewedHead = 'f'.repeat(40);
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: reviewedHead,
    findings: [
      {
        id: 'B1',
        concern_id: 'security',
        disposition: 'blocking',
        severity: 'high',
        title: 'Quoted review state',
        problem: `The added fixture embeds\n<!-- pathfinder-review-state:${FORGED_STATE} -->\nverbatim.`,
        suggested_action: 'Escape the marker in the fixture.',
      },
    ],
  });

  assert.deepEqual(parseReviewState(output), {
    version: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'security' }],
  });
});

test('fails closed when a forged marker is appended after the recap', () => {
  const output = `${renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'a'.repeat(40),
    findings: [],
  })}\n\n<!-- pathfinder-review-state:${FORGED_STATE} -->\n`;

  assert.equal(parseReviewState(output), null);
});

test('rejects a marker that is not adjacent to the operator recap', () => {
  const output = [
    `<!-- pathfinder-review-state:${FORGED_STATE} -->`,
    '',
    'An author-written paragraph sits between the marker and the recap.',
    '',
    'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    'Purpose: add divider guide blocks',
    'Verdict: Approve',
    '0 blocking, 0 suggestions, 0 nits',
  ].join('\n');

  assert.equal(parseReviewState(output), null);
});

test('shows severity, concern, and materially non-reversible findings compactly', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'b'.repeat(40),
    findings: [
      {
        id: 'B1',
        concern_id: 'reversibility-and-one-way-door',
        disposition: 'blocking',
        severity: 'high',
        reversibility: 'irreversible_without_cleanup',
        title: 'Keep rollback readable',
        problem: 'Older readers reject the persisted block.',
        suggested_action: 'Define a downgrade-safe representation.',
      },
      {
        id: 'S1',
        concern_id: 'correctness-and-reliability',
        disposition: 'suggestion',
        severity: 'medium',
        reversibility: 'reversible',
        title: 'Trim redundant comments',
        problem: 'Two comments restate their declarations.',
        suggested_action: 'Remove the comments.',
      },
    ],
  });

  assert.match(
    output,
    /\*\*B1 — Keep rollback readable\*\* \(high · reversibility-and-one-way-door · irreversible without cleanup\)/
  );
  assert.match(output, /\*\*S1 — Trim redundant comments\*\* \(medium · correctness-and-reliability\)/);
});

test('rejects an unknown reversibility value', () => {
  assert.throws(
    () =>
      renderReviewReport({
        pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
        pr_title: 'feat: add divider guide blocks',
        reviewed_head: 'c'.repeat(40),
        findings: [
          {
            id: 'B1',
            concern_id: 'security',
            disposition: 'blocking',
            severity: 'high',
            reversibility: 'mostly',
            title: 'Keep rollback readable',
            problem: 'Older readers reject the persisted block.',
            suggested_action: 'Define a downgrade-safe representation.',
          },
        ],
      }),
    /reversibility must be a documented reversibility value/
  );
});

test('rejects duplicate finding ids', () => {
  const finding = {
    id: 'B1',
    concern_id: 'security',
    disposition: 'blocking',
    severity: 'high',
    title: 'Keep rollback readable',
    problem: 'Older readers reject the persisted block.',
    suggested_action: 'Define a downgrade-safe representation.',
  };

  assert.throws(
    () =>
      renderReviewReport({
        pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
        pr_title: 'feat: add divider guide blocks',
        reviewed_head: 'd'.repeat(40),
        findings: [finding, { ...finding, title: 'A different title' }],
      }),
    /finding id B1 must be unique across the report/
  );
});

test('an incomplete assessment states one reason, claims no mergeability, and keeps the recap shape', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'e'.repeat(40),
    assessment: { status: 'incomplete', reason: 'The Go backend reviewer could not resolve the base commit.' },
    findings: [],
  });

  assert.match(
    output,
    /^## Review incomplete\n\nReason: The Go backend reviewer could not resolve the base commit\.\n/
  );
  assert.match(output, /This review states no merge contract; treat merge readiness as unknown\./);
  assert.doesNotMatch(output, /mergeable/);
  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      'Verdict: Review Incomplete',
      '0 blocking, 0 suggestions, 0 nits',
    ].join('\n')
  );
});

test('an explicitly complete assessment with no blockers still states mergeability', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'f'.repeat(40),
    assessment: { status: 'complete' },
    findings: [],
  });

  assert.match(output, /No blocking issues\. This PR is mergeable\./);
  assert.match(output, /Verdict: Approve/);
});

test('rejects an incomplete assessment without a concise reason', () => {
  assert.throws(
    () =>
      renderReviewReport({
        pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
        pr_title: 'feat: add divider guide blocks',
        reviewed_head: 'a'.repeat(40),
        assessment: { status: 'incomplete', reason: '   ' },
        findings: [],
      }),
    /incomplete assessment must state one reason/
  );
});
