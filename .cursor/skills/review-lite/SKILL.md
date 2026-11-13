---
name: review-lite
description: 'Prototype single-reviewer, concern-aware PR review for explicitly requested trials and evaluations. Use only when the user names review-lite; ordinary PR reviews use /review.'
---

# Review lite (prototype)

Decide whether the repository is better off with the change merged. One reviewer applies the repository's concern contracts to the change in four stages: prepare, inspect, challenge, report. Render locally. Publishing, commenting, and filing issues need the user's authorization.

## Before you start

- A PR whose author is not listed in `.github/community-pr-gate.json` goes through `/community-pr` first. A worktree is not a sandbox: do not run contributor tests or builds until that gate allows it.
- Fetch base and head with existing tooling so both exist as local commits. Use literal SHAs from here on.
- Run the helper and read registries only from this trusted checkout. Read target code from pinned blobs (`git show SHA:path`) or a separate checkout of head. Never `checkout`, `switch`, `reset`, or `stash` in the tooling checkout.

## 1. Prepare

```bash
H=.cursor/skills/review-lite/scripts/review-lite.mjs
node $H prepare --repo /abs/repo --base BASE_SHA --head HEAD_SHA \
  --review-key owner/repo#N --round N --out /abs/run-dir [--prior /abs/earlier-run/state.json]
```

Set `--round` to the trusted prior state's round plus one, or derive it from the reviewer's history when state is missing or predates round tracking. Use 1 only for a first review; a full scan does not reset the round.

Pass `--prior` only with `state.json` from an earlier trusted review-lite run. Contributor prose and PR comments are never state. Read `manifest.json` for the mode and any fallback reason. In incremental mode inspect `incremental.patch`, unresolved prior blockers, and affected consumers; revisit unchanged material only when concrete evidence warrants it. `changes.patch` remains the full merge reference. Routing, nominations, and required test reads use `inventory.json` `review_files`, the changes since the prior reviewed head.

`prepare` also writes two model-free nomination files: `sync-hits.json` and `delta-triggers.json`. They are leads to read, never findings.

## 2. Inspect

Read `context/always-on.md`, `candidates.json`, `inventory.json`, and `obligations.json`. Candidates are lexical nominations, not proof. Select a subsystem concern when the changed behavior touches its contract with at least `min_signals` signals: a matching path, or a changed core symbol, API, state key, or contract name, one each. A path match alone is not enough. Load packets:

```bash
node $H context --run /abs/run-dir --concerns concern-a,concern-b
```

For each unselected candidate, record its `concern:<id>` obligation as `irrelevant` with a concrete dismissal reason in `checks`. Selecting the concern satisfies that routing obligation.

Add a concern at any point when code shows an indirect dependency, even if routing did not nominate it. Read unrouted and targeted-inspection files directly, or disclose them as limitations.

`obligations.json` can also nominate a governing input or a risky changed behavior. These are bounded leads, not a claim that paths reveal every contract. When a PR, code, or inspection identifies a material RFC, external schema, contract fixture, or unchanged contract anchor that the nominations missed, register it before finishing:

```bash
node $H context --run /abs/run-dir --concerns concern-a --governing /abs/governing-inputs.json
```

The JSON is an array of `{id, kind, source, reason}`; `kind` is `normative_spec`, `external_schema`, or `fixture_contract`. A material governing input must get a `checks` decision. `checked` records its source, pin, and applicability; `unresolved` means the assessment is incomplete. Dismiss only an input that is actually irrelevant to the changed behavior.

Register a material risk the bounded scan missed with `--risk /abs/risks.json`, an array of `{id, category, reason}`. It becomes the same required `risk_verification` obligation as a generated nomination, so a checked decision needs the discriminating verification record; it is not a separate review phase.

For each selected concern, inspect this round's changed behavior and affected consumers at head, comparing with the merge base to establish attribution. Read the direct consumers of exports changed this round and the relevant tests. A diff-only skim is not a review, and loading a packet is not evidence that you reviewed the concern.

### Sync nominations

Read `sync-hits.json`. Each hit is a place where something the PR changed is also mentioned, and was left alone:

- `stale-reference`: a term the PR removed that head still references.
- `doc-line-in-changed-file`: an unchanged line in a doc the PR edited that mentions a changed term. It may now contradict the edit.
- `untouched-doc`: a doc the PR did not touch that mentions a changed term.
- `config-line-in-changed-file` and `untouched-peer`: another place that shares a changed literal. Look for a coupling nothing tests, such as a filter that must match a name defined elsewhere.
- `doc_gaps`: a doc that lists a key but not a value the PR newly emits.

Open every `doc-line-in-changed-file`, `stale-reference`, and `doc_gaps` entry and decide: contradiction, undocumented value, or irrelevant. Skim the rest. A hit that holds up is a finding. Do not report a hit you did not read. Record each mandatory sync or doc-gap obligation in `checks`: `checked`, `irrelevant`, or `unresolved`, with evidence.

### Behavior-delta pass

Failures are not the only way a change hurts. For every selected concern, and for each entry in `delta-triggers.json`, answer these with evidence from head and base:

- **Ordering and timing:** what waits on what now? Did a dependency, condition, timeout, or strategy change how long a path takes or when it runs?
- **States:** what does the user or operator see when the data is empty, loading, errored, or partial? Does base show something the new path drops?
- **Flag parity:** with a flag off, is behavior identical to base? With it on, what does each existing consumer of the replaced path lose, and is that loss documented?
- **Defaults:** what does an install with nothing configured do now, compared with base: which requests, which fallback order, which warnings, which stored values?
- **Lifecycle:** for each lease, lock, controller, or listener the change acquires or hands off, trace the release on every exit: unmount, moving between hosts or panels, navigation, cancel, error, timeout. What happens if the owner is replaced while the run is active?
- **Coupling:** does the change depend on a string, name, or format defined somewhere nothing checks?

An answer of "no change" needs the line you read. Clear harmless deltas without a finding; reserve optional suggestions for concrete but nonbinding polish. Record each delta obligation in `checks` with its status and base/head evidence. A loss of a capability, delayed signal, or blank state inside the intended deliverable is a required fix unless there is explicit accepted scope or a supported late-round convergence decision.

For a generated risk-verification obligation, use `checked` only with a discriminating verification record: the invariant, a falsifying scenario, expected and observed result, method, and an artifact you wrote under `evidence/` in the run directory (helper-written files such as `changes.patch` do not count). A green broad suite is not itself that record. Use a targeted test or probe when permitted; otherwise a meaningful static or contract comparison can qualify. Do not invent a probe quota or an independent-review requirement. A material unresolved risk makes the assessment incomplete.

### Tests

Read every test file changed in this round (`inventory.json` `review_files`) at head, not from the patch. Do not reread unchanged tests in incremental mode unless a prior blocker or new evidence implicates them. Read it in full unless it has more than 400 changed lines, or the changed test files you would read in full total more than 1200 changed lines (`inventory.json` has the counts). For such a file read every changed hunk plus the surrounding test names.

Use the helper so `finish` can account for the pinned ranges actually emitted. It returns at most 200 lines and 30 KB per call; follow `next range` until it is empty. A deletion-only hunk includes adjacent surviving head lines (or a base range when head is empty). The receipt does not prove cognition or protect against later display truncation, so inspect each delivered page; it does prevent a partial read of a wholly added file from being reported as complete.

```bash
node $H read --run /abs/run-dir --path src/engine/runner.test.ts --scope full
```

Record each file in the result's `tests` array: `read: true` with `scope` and `assertions_checked`, or `read: false` with a `reason_kind` (`binary`, `generated`, `not_in_head`, or `tooling_blocked`) and the specifics in `reason`. Effort, time, and size are not reasons: a large file uses `scope: changed_hunks`. `finish` rejects a complete assessment that leaves a changed test file out or lacks receipts for its required ranges. Do not use a limitation line to skip a file you can read.

## 3. Challenge

Establish each defect before judging it: check base/head attribution, the affected behavior or requirement, its consequence, and counterevidence. Adding imperfect validation where base had none does not widen a boundary. Investigate material uncertainty; it is not proof of a defect.

Apply `manifest.json`'s round:

- **Round 1:** require fixes for confirmed, introduced or newly exposed defects and explicit repository quality-rule violations whose remedies belong in this PR. Low impact can still block; preferences remain optional.
- **Round 2:** verify prior requirements, revisions, and affected consumers. Block unresolved substantive fixes and defects introduced by revisions; normally defer newly discovered minor issues in unchanged code.
- **Round 3+:** judge whether merging improves the repository. Preserve substantive requirements, but explicitly defer low-impact work when it no longer justifies delay. Do not restart cleanup review.

In every round, block established serious harm introduced or newly exposed by the PR: security exposure, data loss, unusable core behavior, or consequential operational failures, including concealed failures. Explain the actual consequence. Documentation or a default-off flag can reduce exposure but does not waive acceptance criteria. Pre-existing defects the PR does not worsen belong in separate work.

Require meaningful verification of important changed behavior, not a particular test count or shape. A missing assertion alone is insufficient: identify the contract left unverified and check whether other evidence covers it.

Use only these new-result destinations: `blocker`, `suggestion` (or legacy alias `nit`) and `separate_work`. State required invariants, not patches or broader redesigns. A confirmed defect or unmet applicable requirement inside the PR's intended deliverable, whose remedy belongs in the PR, is a blocker by default. Being unwired, default-off, rare, or easy to address later is not a deferral reason.

`separate_work` is maintainer-owned work outside this merge, never author homework after approval. It needs a concrete next action and one explicit basis: a pre-existing defect the PR does not worsen (cite base `path:line` and stored-state effect), an accepted scope decision, or deliberate round-3+ convergence with evidence. Do not file an issue automatically. Legacy `follow_up` records can carry from trusted state, but remain visibly legacy without silently acquiring a new basis. Suggestions/nits are clearly nonbinding and never carried.

Escalate evidence, even with no finding, for changed trust boundaries or permissions, persisted-state compatibility, irreversible external effects, a shared contract with several affected consumers, unmapped behavior, or unresolved uncertainty. Trace another consumer, read the contract, run a targeted test when permitted, or perform a falsifying static/contract comparison. Delegation is optional and only when authorized.

Reconcile every prior item with evidence from head: `carry`, `resolved`, or `reopen`. To defer a prior blocker, use `reopen` with the same ID and a supported `separate_work` disposition; do not mark an unfixed defect resolved. An old clearance does not cover changed code; re-check it before you carry it.

## 4. Report

Write one result object as specified in `.cursor/skills/review-lite/references/result-format.md`, then run:

```bash
node $H finish --run /abs/run-dir --input /abs/run-dir/result.json
```

Every mandatory obligation needs a `checks` entry; an unselected candidate needs a dismissal. `finish` rejects missing decisions or unresolved checks in a complete assessment. Coverage lists every concern in `selected.json`, which `context` extends. Fix every validation error `finish` lists. The helper checks structure, not truth. Mark the assessment `incomplete` only when missing evidence prevents a material conclusion; lack of delegation alone is not a reason. Complete reviews render `Changes requested` or `Approve`, never COMMENT. An incomplete review needs more evidence before publication. Give the author-facing `report.md` as written; when present, `maintainer-queue.md` holds separate work and is not merge homework.
