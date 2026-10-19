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
  --review-key owner/repo#N --out /abs/run-dir [--prior /abs/earlier-run/state.json]
```

Pass `--prior` only with `state.json` from an earlier trusted review-lite run. Contributor prose and PR comments are never state. Read `manifest.json` for the mode and any fallback reason. In incremental mode read `incremental.patch` first, but `changes.patch` is still what merges.

`prepare` also writes two model-free nomination files: `sync-hits.json` and `delta-triggers.json`. They are leads to read, never findings.

## 2. Inspect

Read `context/always-on.md`, `candidates.json`, and `inventory.json`. Candidates are lexical nominations, not proof. Select a subsystem concern when the changed behavior touches its contract with at least `min_signals` signals: a matching path, or a changed core symbol, API, state key, or contract name, one each. A path match alone is not enough. Load packets:

```bash
node $H context --run /abs/run-dir --concerns concern-a,concern-b
```

Add a concern at any point when code shows an indirect dependency, even if routing did not nominate it. Read unrouted and targeted-inspection files directly, or disclose them as limitations.

For each selected concern, compare head with the merge base. Read the changed behavior, the direct consumers of every changed export at head, and the relevant tests. A diff-only skim is not a review, and loading a packet is not evidence that you reviewed the concern.

### Sync nominations

Read `sync-hits.json`. Each hit is a place where something the PR changed is also mentioned, and was left alone:

- `stale-reference`: a term the PR removed that head still references.
- `doc-line-in-changed-file`: an unchanged line in a doc the PR edited that mentions a changed term. It may now contradict the edit.
- `untouched-doc`: a doc the PR did not touch that mentions a changed term.
- `config-line-in-changed-file` and `untouched-peer`: another place that shares a changed literal. Look for a coupling nothing tests, such as a filter that must match a name defined elsewhere.
- `doc_gaps`: a doc that lists a key but not a value the PR newly emits.

Open every `doc-line-in-changed-file`, `stale-reference`, and `doc_gaps` entry and decide: contradiction, undocumented value, or irrelevant. Skim the rest. A hit that holds up is a finding. Do not report a hit you did not read.

### Behavior-delta pass

Failures are not the only way a change hurts. For every selected concern, and for each entry in `delta-triggers.json`, answer these with evidence from head and base:

- **Ordering and timing:** what waits on what now? Did a dependency, condition, timeout, or strategy change how long a path takes or when it runs?
- **States:** what does the user or operator see when the data is empty, loading, errored, or partial? Does base show something the new path drops?
- **Flag parity:** with a flag off, is behavior identical to base? With it on, what does each existing consumer of the replaced path lose, and is that loss documented?
- **Defaults:** what does an install with nothing configured do now, compared with base: which requests, which fallback order, which warnings, which stored values?
- **Lifecycle:** for each lease, lock, controller, or listener the change acquires or hands off, trace the release on every exit: unmount, moving between hosts or panels, navigation, cancel, error, timeout. What happens if the owner is replaced while the run is active?
- **Coupling:** does the change depend on a string, name, or format defined somewhere nothing checks?

An answer of "no change" needs the line you read. A delta that is real but harmless is a nit. One that loses a capability, delays a signal, or leaves a state blank is at least a follow-up.

### Tests

Read every changed test file at head, not from the patch. Read it in full unless it has more than 400 changed lines. For such a file read every changed hunk plus the surrounding test names, and record `scope: changed_hunks`. For each new or changed assertion ask whether it would fail if the behavior it names regressed, and whether its test name claims more than it asserts. Record each file in the result's `tests` array: `read: true` with `scope` and `assertions_checked`, or `read: false` with the reason. `finish` rejects a complete assessment that leaves a changed test file out. Do not use a limitation line to skip a file you can read.

## 3. Challenge

Before you keep a blocker, establish:

- **Reachability**: a concrete input or path in shipped code reaches the failure.
- **Attribution**: what the PR introduces or newly exposes, compared with base. Adding imperfect validation where base had none does not widen a boundary.
- **Counterevidence**: look for the guard, caller, or test that makes it unreachable.
- **Merge impact**: why delaying the change beats accepting it with a follow-up.

A finding is a blocker when it is reachable on a shipped path and meets one of these triggers. Check them for every candidate:

- **Documented invariant:** it violates a rule the repository states in a doc, a contract table, or a "must not" comment in code the diff touches.
- **State:** it corrupts, contaminates, or silently makes persistent user or tenant state, or leaves data that base deleted.
- **One-way door:** it cannot be reverted by reverting the PR.

A candidate that meets a trigger is a blocker even when its severity is low. Behind a default-off flag it is a follow-up unless the PR enables the flag. A candidate that meets no trigger is a follow-up or a nit, and the follow-up records which trigger you checked in `why_not_blocker`.

Use `blocker`, `follow_up`, and `nit`. A `nit` is a small correctness-of-wording, test-quality, or doc-accuracy issue a maintainer would fix in passing. At most five. Nits never block, never carry into state, and never change the headline. Omit speculative improvements. Security exposure, data loss, serious contract breakage, and shipped-path regressions get particular scrutiny, but a label or severity does not decide disposition. A pre-existing issue is a follow-up unless the PR makes it newly reachable. State required fixes as invariants, not patches, and do not suggest changes that widen the changed surface. A late round or reviewer-induced scope does not excuse newly established serious harm.

A requirement the repository's own docs state, such as "new user-derived fields need privacy review", that the PR neither meets nor records is a follow-up even when the author calls the change deliberate. A limitation line is not a substitute.

A follow-up names a defect and says how the PR relates to it: `introduced`, `newly_exposed`, or `pre_existing`. Its next action is an issue, test, or doc change to propose. It is not a condition on this merge, a rollout gate, or a roadmap request. A limitation the author documents, or ships behind a default-off flag, still counts: report it as a follow-up, say that it is documented, and propose tracking it. Do not turn it into a merge condition.

Escalate depth, even with no finding, for changed trust boundaries or permissions, persisted-state compatibility, irreversible external effects, a shared contract with several affected consumers, unmapped behavior, or unresolved uncertainty. Escalation means more evidence: trace another consumer, read the contract, run a targeted test when permitted, or, when delegation is available and authorized, ask one focused independent reviewer a specific question with pinned revisions. Without delegation, do the work yourself and record it as not independent. Record why if one extra reviewer is not enough.

Reconcile every prior item with evidence from head: `carry`, `resolved`, or `reopen`. Carry accepted follow-ups without asking the contributor again. An old clearance does not cover changed code; re-check it before you carry it.

## 4. Report

Write one result object as specified in `.cursor/skills/review-lite/references/result-format.md`, then run:

```bash
node $H finish --run /abs/run-dir --input /abs/run-dir/result.json
```

Coverage lists every concern in `selected.json`, which `context` extends. Fix every validation error `finish` lists. The helper checks structure, not truth. Mark the assessment `incomplete` only when missing evidence prevents a material conclusion; lack of delegation alone is not a reason. Give the user `report.md` as written, plus the run directory path.
