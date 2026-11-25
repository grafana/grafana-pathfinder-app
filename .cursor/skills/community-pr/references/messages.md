# Message contract

Community contributors are volunteers. Every outward message starts with a specific thank-you, gives one actionable piece of content, and ends with what happens next. Do not weaken review findings to create warmth.

## Scanner stop

This is an internal maintainer message, not a PR comment. Do not read more contributor content merely to personalize it.

> PR #`<number>` stopped at the pre-content workflow scan.
>
> New serious finding: `<severity> <audit id>` in `<repository-relative path>` at `<route or line>`.
>
> No CI was authorized and the PR was not handed to review. A maintainer must inspect the workflow change without executing it.

## Contributor blocker

Use the sanitized title from the cleared snapshot to name the contribution without opening the body or following links. Use the helper's `binding_sha`-pinned contributor-guide URL.

> Thanks for `<specific contribution>` — `<one clause on why it is useful>`.
>
> One thing to clear before we review: `<primary blocker in plain terms>`. `<One or two sentences linking the binding-SHA contributor guide, or — for a merge-conflicts blocker — one sentence asking the contributor to rebase or merge the base branch and resolve the conflicts>`.
>
> Once that is done, we will pick this up for review.

If more than one of CLA, signing, and merge-conflicts fails, use the binding's effective `blocker_priority` (declared order, with any blocker the binding omits appended after it in the fixed `cla`, `signing`, `merge_conflicts` order) and mention the rest only in one short clause. A merge-conflicts blocker never needs the contributor-guide link — the fix is local to the PR branch.

## Already-informed skip

Internal maintainer-facing only; never posted to the PR. Use when an active CLA, signing, or merge-conflicts blocker from this reviewer is already on the PR.

> PR <url>: Blocked on needing to sign the CLA, user has been informed.
> PR <url>: Blocked on needing to sign all git commits, user has been informed.
> PR <url>: Blocked on merge conflicts with the base branch, user has been informed.

If more than one gate already has a comment, report only the binding's effective `primary_blocker` gate.

## CI authorization

```text
CI authorization — PR #<number> by @<author>

Scanner:   <0 new serious; k other new; m carried-forward baseline findings>
CI surface: <untouched | N changed paths: a, b, c>   # workflows plus any file CI invokes
Size:      <files> files, +<additions>/-<deletions>
Author:    <k PRs merged here before | first contribution here>

For:       <one evidence line>
Against:   <one evidence line>
Recommend: <authorize | do not authorize> — <one-line reason>

Authorize the held repository workflows for this exact head SHA? (yes / no)
```

## CI failure

> Thanks for `<specific contribution>`.
>
> CI is failing on this one: `<check name>` reported `<verbatim bounded failure evidence>`. `<One line on where to look>`.
>
> Push a fix and CI will rerun; we will review once it is green.

Never quote a failure that was not read. Never post this for infrastructure, fork-permission, or absent-run cases.

If review work already produced a disposition, findings, or body before the CI failure was confirmed — complete or partial — append them after the "we will review once it is green" line, introduced by one short sentence such as "In the meantime, here is what review found so far:", followed by the unchanged existing content. Do not perform additional review work to complete or deepen the review once a contributor-caused CI failure is confirmed; use only what already exists at that point.

## Review framing

Add a specific thank-you before the unchanged repository review body and a concrete next step after it. Do not edit, soften, or reclassify review findings.
