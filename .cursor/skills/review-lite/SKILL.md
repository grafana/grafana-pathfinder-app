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

## 2. Inspect

Read `context/always-on.md`, `candidates.json`, and `inventory.json`. Candidates are lexical nominations, not proof. Select a subsystem concern when the changed behavior touches its contract with at least `min_signals` signals: a matching path, or a changed core symbol, API, state key, or contract name, one each. A path match alone is not enough. Load packets:

```bash
node $H context --run /abs/run-dir --concerns concern-a,concern-b
```

Add a concern at any point when code shows an indirect dependency, even if routing did not nominate it. Read unrouted and targeted-inspection files directly, or disclose them as limitations.

For each selected concern, compare head with the merge base. Read the changed behavior, the direct consumers of every changed export at head, and the relevant tests. A diff-only skim is not a review, and loading a packet is not evidence that you reviewed the concern.

## 3. Challenge

Before you keep a blocker, establish:

- **Reachability**: a concrete input or path in shipped code reaches the failure.
- **Attribution**: what the PR introduces or newly exposes, compared with base. Adding imperfect validation where base had none does not widen a boundary.
- **Counterevidence**: look for the guard, caller, or test that makes it unreachable.
- **Merge impact**: why delaying the change beats accepting it with a follow-up.

Use only `blocker` and `follow_up`. Omit nits and speculative improvements. Security exposure, data loss, serious contract breakage, and shipped-path regressions get particular scrutiny, but a label or severity does not decide disposition. A pre-existing issue is a follow-up unless the PR makes it newly reachable. State required fixes as invariants, not patches, and do not suggest changes that widen the changed surface. A late round or reviewer-induced scope does not excuse newly established serious harm.

Escalate depth, even with no finding, for changed trust boundaries or permissions, persisted-state compatibility, irreversible external effects, a shared contract with several affected consumers, unmapped behavior, or unresolved uncertainty. Escalation means more evidence: trace another consumer, read the contract, run a targeted test when permitted, or, when delegation is available and authorized, ask one focused independent reviewer a specific question with pinned revisions. Without delegation, do the work yourself and record it as not independent. Record why if one extra reviewer is not enough.

Reconcile every prior item with evidence from head: `carry`, `resolved`, or `reopen`. Carry accepted follow-ups without asking the contributor again. An old clearance does not cover changed code; re-check it before you carry it.

## 4. Report

Write one result object as specified in `.cursor/skills/review-lite/references/result-format.md`, then run:

```bash
node $H finish --run /abs/run-dir --input /abs/run-dir/result.json
```

Coverage lists every concern in `selected.json`, which `context` extends. Fix every validation error `finish` lists. The helper checks structure, not truth. Mark the assessment `incomplete` only when missing evidence prevents a material conclusion; lack of delegation alone is not a reason. Give the user `report.md` as written, plus the run directory path.
