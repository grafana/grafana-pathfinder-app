<!--
Thanks for contributing! A few prompts to help your PR land quickly.
See CONTRIBUTING.md for the full guide.

If you're an agent opening this PR, use the pr-summary skill instead of filling
in this template by hand. It contains our style guide for what makes a good PR
description.

Match each section's depth to the weight of the change: a typo fix needs a
Summary and little else. You may add optional "Reversibility" (when undoing the
change is non-obvious) and "Out of scope" (for series PRs or deliberate
omissions) sections.
-->

## Summary

<!-- One to three sentences: the behavior change and why it matters to a reviewer. For a bug fix, give the problem, root cause, and fix. -->

## What to look at

<!-- One bullet per area: the load-bearing change and the interaction to trace, not a file list. Omit for tiny fixes. -->

## Why

<!-- The constraint, rejected alternative, or user reason behind the change. Omit when Summary already says it. -->

## How to verify

<!--
Numbered, PR-specific manual steps a reviewer can run. Map them to the acceptance
criteria of the linked issue. For a bug fix, start with how to reproduce the old
behavior on main (or explain why it cannot be reproduced locally), then confirm
the fix. CI runs typecheck, lint, prettier, and tests, so leave those out. Name
any check you could not run and why; never claim a step passed that you did not run.
-->

## Breaking changes

<!-- "None." or what breaks, for whom, and any migration needed. -->

Fixes #

<!-- Use "Fixes #123" for a bug, "Closes #123" for a feature, or "Refs #123" for related work. Link the prepared (agent/ready) issue. -->

## Checklist

- [ ] This PR addresses a **single concern** (one bug fix or feature, or a set of closely-related changes). Unrelated changes belong in separate PRs; see [CONTRIBUTING.md](../CONTRIBUTING.md#pull-request-scope).
- [ ] All commits are signed (required, or the checks will not pass). See [CONTRIBUTING.md](../CONTRIBUTING.md#signed-commits).
- [ ] I've added or updated tests for the change.
- [ ] `npm run check` passes locally — the pre-merge gate. `npm run check -- --list` prints what it runs.
- [ ] UI text and docs use [sentence case](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization).

<!-- Not sure how to split a larger change, or whether something fits in one PR? Open it as a draft and ask. We're happy to help. -->
