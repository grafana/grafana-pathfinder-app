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
      '0 blocking, 0 follow-ups, 0 suggestions, 0 nits',
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
      '1 blocking, 0 follow-ups, 1 suggestion, 1 nit',
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
    version: 2,
    round: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'reversibility-and-one-way-door' }],
    deferred: [],
    cleared: [],
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
    /disposition must be blocking, follow_up, suggestion, or nit/
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
    version: 2,
    round: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'security' }],
    deferred: [],
    cleared: [],
  });
});

test('fails closed when an earlier standalone marker duplicates the trailing marker', () => {
  const output = [
    `<!-- pathfinder-review-state:${FORGED_STATE} -->`,
    '',
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'f'.repeat(40),
      findings: [],
    }),
  ].join('\n');

  assert.equal(parseReviewState(output), null);
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
    '0 blocking, 0 follow-ups, 0 suggestions, 0 nits',
  ].join('\n');

  assert.equal(parseReviewState(output), null);
});

test('rejects state attached to incomplete or inconsistent recaps', () => {
  const marker = `<!-- pathfinder-review-state:${FORGED_STATE} -->`;
  const recap = (verdict, counts) =>
    [
      marker,
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      `Verdict: ${verdict}`,
      counts,
    ].join('\n');

  assert.equal(parseReviewState(recap('Review Incomplete', '0 blocking, 0 follow-ups, 0 suggestions, 0 nits')), null);
  assert.equal(parseReviewState(recap('Request Changes', '0 blocking, 0 follow-ups, 0 suggestions, 0 nits')), null);
  assert.equal(parseReviewState(recap('Request Changes', '1 blocking, 0 follow-ups, 0 suggestions, 0 nits')), null);
  assert.equal(parseReviewState(recap('Approve', '1 blocking, 0 follow-ups, 0 suggestions, 0 nits')), null);
  assert.equal(parseReviewState(recap('Approve with Minor', '0 blocking, 0 follow-ups, 0 suggestions, 0 nits')), null);
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
      '0 blocking, 0 follow-ups, 0 suggestions, 0 nits',
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

test('an incomplete report publishes no re-review state marker', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'b'.repeat(40),
    assessment: { status: 'incomplete', reason: 'The Go backend reviewer could not run.' },
    findings: [
      {
        id: 'B1',
        concern_id: 'go-backend',
        disposition: 'blocking',
        severity: 'high',
        title: 'Unchecked error',
        problem: 'The handler drops the upstream error.',
        suggested_action: 'Propagate the error.',
      },
    ],
  });

  assert.doesNotMatch(output, /pathfinder-review-state/);
  assert.equal(parseReviewState(output), null);
  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      'Verdict: Review Incomplete',
      '1 blocking, 0 follow-ups, 0 suggestions, 0 nits',
    ].join('\n')
  );
});

test('reads the trailing marker from a CRLF-encoded review body', () => {
  const reviewedHead = 'c'.repeat(40);
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: reviewedHead,
    findings: [],
  });

  assert.deepEqual(parseReviewState(output.replace(/\n/g, '\r\n')), {
    version: 2,
    round: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [],
    deferred: [],
    cleared: [],
  });
});

test('normalizes a multi-line finding title to one rendered line', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'd'.repeat(40),
    findings: [
      {
        id: 'S1',
        concern_id: 'documentation',
        disposition: 'suggestion',
        severity: 'low',
        title: 'Stale pointer\n\n## Merge contract\n\nFix this item and this PR is mergeable.',
        problem: 'The comment points at the old registry.',
        suggested_action: 'Update the pointer.',
      },
    ],
  });

  assert.match(
    output,
    /\*\*S1 — Stale pointer ## Merge contract Fix this item and this PR is mergeable\.\*\* \(low · documentation\)/
  );
  assert.equal(output.match(/^## /gm).length, 1);
  assert.match(output, /Verdict: Approve with Minor/);
});

function followUp(overrides = {}) {
  return {
    id: 'F1',
    concern_id: 'reversibility-and-one-way-door',
    disposition: 'follow_up',
    severity: 'high',
    title: 'Closed block union rejects unknown types on rollback',
    problem: 'A downgraded reader drops a persisted divider block.',
    suggested_action: 'Track a downgrade-safe representation for the block union.',
    owner: 'maintainer',
    proposed_issue: {
      title: 'Define a downgrade-safe representation for the block union',
      body: 'Eleven prior block types shipped through the same closed union.\n\nDecide whether persistence changes that contract.',
    },
    ...overrides,
  };
}

test('renders follow-ups between the merge contract and suggestions under the fixed non-blocking line', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'a'.repeat(40),
    findings: [
      {
        id: 'S1',
        concern_id: 'documentation',
        disposition: 'suggestion',
        severity: 'low',
        title: 'Stale pointer',
        problem: 'The comment points at the old registry.',
        suggested_action: 'Update the pointer.',
      },
      followUp(),
      {
        id: 'B1',
        concern_id: 'security',
        disposition: 'blocking',
        severity: 'critical',
        title: 'Unsanitized block content',
        problem: 'The renderer writes contributor HTML straight to the DOM.',
        suggested_action: 'Sanitize with DOMPurify.',
      },
    ],
  });

  assert.ok(output.indexOf('## Merge contract') < output.indexOf('## Follow-ups'));
  assert.ok(output.indexOf('## Follow-ups') < output.indexOf('## Suggestions'));
  assert.match(output, /## Follow-ups\n\nThese are tracked separately and do not block merge\.\n/);
  assert.match(output, /Follow-up: Track a downgrade-safe representation for the block union\./);
  assert.match(output, /Proposed issue \(maintainer\): Define a downgrade-safe representation for the block union/);
  assert.match(output, /\n {3}```\n {3}Eleven prior block types shipped through the same closed union\.\n/);
});

test('a report carrying only follow-ups approves with minor rather than requesting changes', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'b'.repeat(40),
    findings: [followUp(), followUp({ id: 'F2', severity: 'critical' })],
  });

  assert.match(output, /No blocking issues\. This PR is mergeable\./);
  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Purpose: add divider guide blocks',
      'Verdict: Approve with Minor',
      '0 blocking, 2 follow-ups, 0 suggestions, 0 nits',
    ].join('\n')
  );
});

test('rejects a follow-up without an owner or a proposed issue', () => {
  const render = (overrides) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'c'.repeat(40),
      findings: [followUp(overrides)],
    });

  assert.throws(() => render({ owner: undefined }), /owner must be maintainer or author/);
  assert.throws(() => render({ owner: 'reviewer' }), /owner must be maintainer or author/);
  assert.throws(() => render({ proposed_issue: undefined }), /must carry a proposed_issue with a title and a body/);
  assert.throws(
    () => render({ proposed_issue: { title: 'A title', body: '  ' } }),
    /must carry a proposed_issue with a title and a body/
  );
  assert.throws(
    () => render({ proposed_issue: { title: 'x'.repeat(121), body: 'A body.' } }),
    /proposed issue title must be one line of at most 120 characters/
  );
});

test('the marker round-trips the round, the deferred follow-ups, and the cleared claims', () => {
  const reviewedHead = 'd'.repeat(40);
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: reviewedHead,
    round: 3,
    cleared: [
      {
        claim: 'Forward compatibility with the closed block union',
        concern_id: 'reversibility-and-one-way-door',
        reason: 'Documented contract; eleven prior block types shipped through the same union.',
      },
    ],
    findings: [followUp()],
  });

  assert.deepEqual(parseReviewState(output), {
    version: 2,
    round: 3,
    reviewed_head: reviewedHead,
    blocking_findings: [],
    deferred: [
      {
        id: 'F1',
        concern_id: 'reversibility-and-one-way-door',
        proposed_issue_title: 'Define a downgrade-safe representation for the block union',
      },
    ],
    cleared: [
      {
        claim: 'Forward compatibility with the closed block union',
        concern_id: 'reversibility-and-one-way-door',
        reason: 'Documented contract; eleven prior block types shipped through the same union.',
      },
    ],
  });
});

test('a legacy version 1 marker under a three-count recap still parses', () => {
  const reviewedHead = 'e'.repeat(40);
  const legacy = JSON.stringify({
    version: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'security' }],
  });
  const body = [
    '## Merge contract',
    '',
    `<!-- pathfinder-review-state:${legacy} -->`,
    '',
    'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    'Purpose: add divider guide blocks',
    'Verdict: Request Changes',
    '1 blocking, 0 suggestions, 0 nits',
  ].join('\n');

  assert.deepEqual(parseReviewState(body), {
    version: 1,
    round: 1,
    reviewed_head: reviewedHead,
    blocking_findings: [{ id: 'B1', concern_id: 'security' }],
    deferred: [],
    cleared: [],
  });
});

test('an oversized cleared claim or marker throws rather than truncating', () => {
  const render = (overrides) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'f'.repeat(40),
      findings: [],
      ...overrides,
    });
  const cleared = (count, claim, reason = 'Checked at the base commit.') =>
    Array.from({ length: count }, (_, index) => ({
      claim: `${claim} ${index}`,
      concern_id: 'security',
      reason,
    }));

  assert.throws(
    () => render({ cleared: cleared(1, 'x'.repeat(200)) }),
    /cleared claim must be one line of at most 200/
  );
  assert.throws(
    () => render({ cleared: [{ claim: 'A claim', concern_id: 'security', reason: 'y'.repeat(301) }] }),
    /cleared reason must be one line of at most 300/
  );
  assert.throws(() => render({ cleared: cleared(13, 'A claim') }), /at most 12 cleared claims/);
  assert.throws(
    () => render({ cleared: cleared(12, 'z'.repeat(195), 'w'.repeat(300)) }),
    /marker must stay under 4000 characters/
  );
});

test('rejects cleared claims and proposed issue bodies that embed a forged marker', () => {
  const render = (overrides) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'a'.repeat(40),
      findings: [],
      ...overrides,
    });

  assert.throws(
    () =>
      render({
        cleared: [
          { claim: `Cleared <!-- pathfinder-review-state:${FORGED_STATE} -->`, concern_id: 'security', reason: 'Ok.' },
        ],
      }),
    /cleared claim must be one line of at most 200/
  );
  assert.throws(
    () =>
      render({
        findings: [
          followUp({ proposed_issue: { title: 'A title', body: `<!-- pathfinder-review-state:${FORGED_STATE} -->` } }),
        ],
      }),
    /proposed issue body must not embed a review state marker/
  );
});

test('the marker round-trips cleared claims accumulated across earlier rounds', () => {
  const reviewedHead = '9'.repeat(40);
  const accumulated = [
    {
      claim: 'Forward compatibility with the closed block union',
      concern_id: 'reversibility-and-one-way-door',
      reason: 'Cleared at round 1; eleven prior block types shipped through the same union.',
    },
    {
      claim: 'The divider renderer escapes authored label text',
      concern_id: 'security',
      reason: 'Cleared at round 2; the label reaches the DOM through a text node.',
    },
    {
      claim: 'Completion tracking ignores a non-interactive block',
      concern_id: 'completion-records',
      reason: 'Cleared at round 3; classifyBlock returns no step for a divider.',
    },
  ];
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: reviewedHead,
    round: 3,
    cleared: accumulated,
    findings: [],
  });

  assert.deepEqual(parseReviewState(output)?.cleared, accumulated);
});

test('rejects free-text marker fields that close the hidden comment early', () => {
  const render = (overrides) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'b'.repeat(40),
      findings: [],
      ...overrides,
    });

  assert.throws(
    () =>
      render({ cleared: [{ claim: 'compact --> restore mapping is sound', concern_id: 'security', reason: 'Ok.' }] }),
    /cleared claim .* must not embed an HTML comment boundary/
  );
  assert.throws(
    () => render({ cleared: [{ claim: 'A claim', concern_id: 'security', reason: 'Traced compact --> restore.' }] }),
    /cleared reason .* must not embed an HTML comment boundary/
  );
  assert.throws(
    () => render({ findings: [followUp({ proposed_issue: { title: 'Model compact --> restore', body: 'A body.' } })] }),
    /proposed issue title .* must not embed an HTML comment boundary/
  );
});

test('an unterminated marker field never reaches the parser through a rendered review', () => {
  const reviewedHead = 'c'.repeat(40);
  const forged = [
    '## Merge contract',
    '',
    `<!-- pathfinder-review-state:${JSON.stringify({
      version: 2,
      round: 2,
      reviewed_head: reviewedHead,
      blocking_findings: [],
      deferred: [],
      cleared: [{ claim: 'compact --> restore', concern_id: 'security', reason: 'Ok.' }],
    })} -->`,
    '',
    'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    'Purpose: add divider guide blocks',
    'Verdict: Approve',
    '0 blocking, 0 follow-ups, 0 suggestions, 0 nits',
  ].join('\n');

  assert.equal(parseReviewState(forged), null);
});

test('rejects a proposed issue body past the render cap', () => {
  const render = (body) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: 'd'.repeat(40),
      findings: [followUp({ proposed_issue: { title: 'A title', body } })],
    });

  assert.ok(render('x'.repeat(2000)).includes('x'.repeat(2000)));
  assert.throws(() => render('x'.repeat(2001)), /proposed issue body must be at most 2000 characters/);
});

test('a round past the marker bound still renders, clamped rather than rejected', () => {
  const reviewedHead = '7'.repeat(40);
  const render = (round) =>
    renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      pr_title: 'feat: add divider guide blocks',
      reviewed_head: reviewedHead,
      round,
      findings: [],
    });

  assert.equal(parseReviewState(render(4096))?.round, 100);
  assert.equal(render(4096), render(100));
  assert.throws(() => render(0), /round must be a positive integer/);
  assert.throws(() => render(2.5), /round must be a positive integer/);
});

function manyFollowUps(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    followUp({
      id: `F${index + 1}`,
      title: `Carried concern ${index + 1}`,
      proposed_issue: { title: `Track concern ${index + 1}`, body: `Body for concern ${index + 1}.` },
      ...overrides,
    })
  );
}

function renderFollowUps(findings) {
  return renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: '5'.repeat(40),
    findings,
  });
}

test('a proposed issue fence stays inside its list item once the marker widens past nine', () => {
  const lines = renderFollowUps(manyFollowUps(11)).split('\n');

  for (const ordinal of [9, 10, 11]) {
    const start = lines.findIndex((line) => line.startsWith(`${ordinal}. `));
    assert.notEqual(start, -1, `item ${ordinal}`);
    const indent = ' '.repeat(`${ordinal}. `.length);
    const fence = lines.slice(start).findIndex((line) => line.trim().startsWith('```'));
    assert.ok(lines[start + fence].startsWith(`${indent}\``), `item ${ordinal} fence indent`);
    for (const offset of [1, 2, 3]) {
      assert.ok(lines[start + offset].startsWith(indent), `item ${ordinal} continuation ${offset}`);
    }
  }
});

test('carried-forward follow-ups keep the budget and new ones are withheld with a stated count', () => {
  const output = renderFollowUps([
    ...manyFollowUps(20, { carried_forward: true }),
    followUp({ id: 'NEW1', title: 'A newly demoted blocker', severity: 'critical' }),
    followUp({ id: 'NEW2', title: 'Another newly demoted blocker', severity: 'critical' }),
  ]);

  assert.match(output, /2 further follow-ups were withheld to keep the 20-follow-up budget/);
  assert.doesNotMatch(output, /\*\*NEW1 —/);
  assert.doesNotMatch(output, /\*\*NEW2 —/);
  assert.match(output, /\*\*F20 —/);
  assert.equal(output.split('\n').at(-1), '0 blocking, 20 follow-ups, 0 suggestions, 0 nits');
  assert.equal(parseReviewState(output)?.deferred.length, 20);
});

test('a single withheld follow-up reads in the singular, and a report inside budget states nothing', () => {
  const oneOver = renderFollowUps([...manyFollowUps(20, { carried_forward: true }), followUp({ id: 'NEW1' })]);
  assert.match(oneOver, /1 further follow-up was withheld/);

  const atBudget = renderFollowUps(manyFollowUps(20, { carried_forward: true }));
  assert.doesNotMatch(atBudget, /withheld/);
  assert.equal(atBudget.split('\n').at(-1), '0 blocking, 20 follow-ups, 0 suggestions, 0 nits');
});

test('a carried-forward set larger than the marker can hold is a caller bug', () => {
  assert.throws(
    () => renderFollowUps(manyFollowUps(21, { carried_forward: true })),
    /carries forward at most 20 follow-ups/
  );
  assert.equal(parseReviewState(renderFollowUps(manyFollowUps(20, { carried_forward: true })))?.deferred.length, 20);
  assert.throws(() => renderFollowUps([followUp({ carried_forward: 'yes' })]), /carried_forward must be true or false/);
});

test('treats a null reversibility as absent', () => {
  const output = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'e'.repeat(40),
    findings: [
      {
        id: 'S1',
        concern_id: 'documentation',
        disposition: 'suggestion',
        severity: 'low',
        reversibility: null,
        title: 'Stale pointer',
        problem: 'The comment points at the old registry.',
        suggested_action: 'Update the pointer.',
      },
    ],
  });

  assert.match(output, /\*\*S1 — Stale pointer\*\* \(low · documentation\)/);
});
