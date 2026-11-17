# pstack / TLA+ completion-queue pilot

Investigation for [#2421](https://github.com/grafana/grafana-pathfinder-app/issues/2421), related to [#603](https://github.com/grafana/grafana-pathfinder-app/issues/603). Off-main pilot on branch `investigate-pstack-completion-queue`, following the pattern of the Bombadil pilot ([#2420](https://github.com/grafana/grafana-pathfinder-app/issues/2420)). Not a required check, not part of `npm run check`, no CI job, no product dependency.

Files:

- `formal/completion-queue/CompletionQueue.tla` — the bounded model.
- `formal/completion-queue/check.sh` — pinned TLC run over a fixed matrix of configs, with one verdict per run.
- `formal/completion-queue/statechart.sh` and `view.mjs` — pstack `/statechart` charts and counterexample reports.
- `formal/completion-queue/results/` — the outputs of the runs recorded below.
- `src/completion-records/completion-write-queue.cross-tab-reset.test.ts` — deterministic reproduction of the defect the model found.

## Tools and pins

| Tool   | Pin                                                                             | How it is obtained                                                                                            |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| TLC    | `tla2tools.jar` v1.7.4, sha256 `936a2620…050e88` (the same pin pstack uses)     | `check.sh` downloads it into `formal/completion-queue/.tools/` (git-ignored) and refuses a checksum mismatch. |
| Java   | any 11+; this run used Oracle Java 27.0.1                                       | System Java, or `JAVA=`. pstack pins Temurin 25 through mise; that path was not used.                         |
| pstack | `cursor/plugins` commit `e1cc03121a0e71129a4fb730d7c5528a0a3e43c8` (2026-11-16) | `statechart.sh` sparse-fetches `pstack/skills/statechart` at that commit into `.tools/`.                      |
| Node   | 23.6+ for pstack's TypeScript scripts; this run used 24.11                      | System Node.                                                                                                  |

All downloads are treated as untrusted data: they live under the git-ignored `.tools/`, the jar is checksum-verified, and pstack is checked out by exact commit. The pstack scripts are run as published, with `TLA2TOOLS` pointing at the verified jar, so pstack's own mise install step is skipped.

## pstack workflow: what ran and what did not

- **`create-formal-verification-skill`** (pstack's formal-verification workflow) is a set of instructions, not a script. Followed: target chosen from the code, TLA+ chosen as the tool, properties stated in plain words, each passing property shown failing on a broken variant, counterexamples replayed against the real code, scope and bounds stated, coverage record and sync commit recorded (below and in `check.sh`). Not done: it asks for a generated project-local skill. This repo's skills need a `.cursor/skills` body, a `.claude/skills` stub and validation-test entries, which is adoption work, so the "Rerun and maintain" section below is the draft of that skill instead.
- **`statechart`** ran as published at the pinned commit. Its reports and Mermaid charts are in `results/statechart/`. Its 500-state chart budget means a chart of the whole graph is drawn only for the one-tab config (106 states); the two-tab config (1,351 states) gets a chart of the bug path only. The 5.25M-state matrix configs are far past the budget, so they are read from TLC output instead.
- **`maintain-formal-verification-skill`** was read, not run. Its drift loop is what `check.sh` approximates with the sync-commit warning.
- Rendering charts to SVG with Pele (pstack's `references/render.md`) was not run. The `.mmd` files render in any Mermaid viewer.

## Modeled scope

Two browser tabs of one `(user, org)` owner, each with its own queue instance and storage adapter, over shared `localStorage`, plus a server.

| Model action          | Code                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Enqueue`             | `enqueue`, `completion-write-queue.ts:184-232` (put at 209, push at 230); ids from `completion-write-hook.ts:235-238` and `:171`                                                                                                       |
| `Reset`               | `clear`, `completion-write-queue.ts:367-370` → `storage.clear`, `completion-write-storage.ts:114-119` (sweeps the owner prefix, lease key included, `:51-53`); entry points `completion-write-hook.ts:113-119`, `:134-136`, `:344-355` |
| `StartDrain`          | `drain` with the `draining` guard, `completion-write-hook.ts:295-313`                                                                                                                                                                  |
| `AcqRead/Write/Check` | `acquireLease`, `completion-write-storage.ts:121-139` (read 123, write 128, read back 129); `processDue`, `completion-write-queue.ts:238-243`                                                                                          |
| `AcqCheck` (refresh)  | `refresh`, `completion-write-queue.ts:141-166`; `due` snapshot `:251-252`                                                                                                                                                              |
| `NextItem`            | loop head and membership skip `completion-write-queue.ts:255-267`; held partial put `:291-295`                                                                                                                                         |
| `RenRead/Write`       | `renewLease`, `completion-write-storage.ts:141-159` (read 143, vanished-lease check 148, write 152); called at `completion-write-queue.ts:297-299`                                                                                     |
| `SendPost`            | `renewLease` read back `completion-write-storage.ts:153`, then `send(item.body, item.id)`, `completion-write-queue.ts:301-309`                                                                                                         |
| `ServerApply`         | record name from `(userID, idempotencyKey)`, `pkg/plugin/completion_records_write.go:251`, `:484`; 409 treated as success, `:260-263`                                                                                                  |
| `PostCreated`         | `completion-write-queue.ts:318-324`                                                                                                                                                                                                    |
| `PostTransient`       | membership re-check and re-put, `completion-write-queue.ts:348-356`; a rejecting sender is transient, `:310-312`                                                                                                                       |
| `RelRead/RelRemove`   | `releaseLease`, `completion-write-storage.ts:161-168` (read 164, remove 165), from `finally` at `completion-write-queue.ts:245-247`                                                                                                    |
| `LeaseExpires`        | `LEASE_TTL_MS`, `completion-write-timing.ts:10`, symbolic                                                                                                                                                                              |

**Granularity.** In `op` mode every `localStorage` call is its own step, so the lease is read / write / read-back and never atomic, as #2421 asks. Within one tab, code between two awaits runs to completion, so that tab's own enqueue or reset can only interleave with its drain while the POST is in flight (the only await in `processDue`). `task` mode is stricter: another tab steps only while this tab is idle or awaiting the POST. That matches browsers that give each task a consistent view of `localStorage`; `op` mode over-approximates them. Every finding below holds in `task` mode, so none depends on the over-approximation.

**Assumptions.**

- Backend dedup: the server's records are a set of idempotency keys. A timed-out request can still be applied later, and a request may never be applied. Clearing the client queue does not undo a request on the wire.
- `created` is returned only once the server holds the key (directly or by a dedup 409).
- `refresh()`'s `storage.list()` and `clear()`'s prefix sweep are atomic steps. Both are loops over keys in the code.
- The retry counter saturates at `MaxAttempts`. Only the `retryKey` variant reads it, so the matrix uses 0 elsewhere, which is exact.
- A reset mints new attempt ids, so a cleared id is never enqueued again; a completion id is enqueued by one tab, and a partial attempt id can be enqueued by both tabs.

**Omitted.** Expiry past `MAX_RETENTION_MS`, eviction over `maxSize`, terminal (4xx) drops, `route-missing` / `forbidden` disarm, the drain budget, backoff timing (every stored item is due), the volatile fallback when `localStorage.setItem` throws, per-guide reset (`discardAttemptPartials`), attempt currency (`isAttemptCurrent`, `completion-write-queue.ts:278`), the recorder's guards, and owner isolation. Owner isolation is not an interleaving question: the owner prefix is fixed when the adapter is built (`completion-write-storage.ts:50-53`), the trailing `:` stops `user-1:org-1:` from prefixing `user-1:org-11:`, and `completion-write-storage.test.ts` "does not expose one owner queue to another owner" covers it. So the third candidate property in #2421 was not modeled.

## Properties

| Id  | Name                  | Statement                                                                                                                    | Harm if broken                                                       |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P1  | `ClearedStaysCleared` | A record withdrawn by "reset all" never comes back into storage.                                                             | A completion the reader reset is sent afterwards and recorded again. |
| P2  | `OneRecordPerEvent`   | Retries and lease takeovers reuse one key, so the server holds at most one record per event (given dedup).                   | Duplicate completion records.                                        |
| P3  | `NoSilentLoss`        | An accepted, non-withdrawn record stays in storage until the server holds it (within the omitted drop paths).                | A completion is lost without a trace.                                |
| T1  | `ExclusiveSend`       | Tolerated, expected to fail: at most one tab is awaiting a POST. The design relies on P2's dedup for this, not on the lease. | None while P2 holds; it records how much the design leans on dedup.  |

## Results (one machine, Apple M5 Pro, TLC 1.7.4, Java 27, 2026-11-17)

`formal/completion-queue/check.sh`; per-run configs, logs and shortest paths go to `formal/completion-queue/out/<timestamp>/`. All runs use one worker and `-fp 0`, so state counts are reproducible. Two-tab runs use `SYMMETRY` over tabs.

| Run                      | Config (tabs, events, granularity, variant) | Invariant             | Verdict   | Distinct states | Depth | Seconds |
| ------------------------ | ------------------------------------------- | --------------------- | --------- | --------------: | ----: | ------: |
| `p1-cross-tab-op`        | 2, `c1 p1`, op, current code                | `ClearedStaysCleared` | VIOLATION |             712 |     8 |       1 |
| `p1-cross-tab-task`      | 2, `c1 p1`, task, current code              | `ClearedStaysCleared` | VIOLATION |             965 |    12 |       1 |
| `p1-one-tab`             | 1, `c1 p1`, op, current code                | `ClearedStaysCleared` | PASS      |           3,166 |    61 |       0 |
| `p1-one-tab-mutant`      | 1, `c1 p1`, op, no membership re-check      | `ClearedStaysCleared` | VIOLATION |             165 |    12 |       1 |
| `p2-key-stable`          | 2, `c1 p1`, op, current code                | `OneRecordPerEvent`   | PASS      |       5,250,709 |    74 |      92 |
| `p2-key-mutant`          | 2, `c1 p1`, op, key varies per retry        | `OneRecordPerEvent`   | VIOLATION |          95,968 |    21 |       2 |
| `p3-no-loss`             | 2, `c1 p1`, op, current code                | `NoSilentLoss`        | PASS      |       5,250,709 |    74 |      91 |
| `p3-no-loss-mutant`      | 2, `c1 p1`, op, drop on transient           | `NoSilentLoss`        | VIOLATION |           2,656 |    11 |       1 |
| `t1-send-race-no-expiry` | 2, `c1`, op, no lease expiry                | `ExclusiveSend`       | VIOLATION |             455 |    18 |       1 |
| `t1-send-task-no-expiry` | 2, `c1`, task, no lease expiry              | `ExclusiveSend`       | PASS      |             223 |    34 |       1 |
| `t1-send-task-expiry`    | 2, `c1`, task, with lease expiry            | `ExclusiveSend`       | VIOLATION |             176 |    19 |       0 |
| `fix-transient-only`     | 2, `c1 p1`, task, trial fix A               | `ClearedStaysCleared` | VIOLATION |           1,709 |    14 |       1 |
| `fix-both-task`          | 2, `c1 p1`, task, trial fix B               | `ClearedStaysCleared` | PASS      |         222,924 |    69 |       4 |
| `fix-both-task-no-loss`  | 2, `c1 p1`, task, trial fix B               | `NoSilentLoss`        | PASS      |         222,924 |    69 |       4 |
| `fix-both-op`            | 2, `c1 p1`, op, trial fix B                 | `ClearedStaysCleared` | VIOLATION |           1,235 |     9 |       1 |

Every verdict matched its expected value, so the script exited 0. A full run takes about 3.5 minutes (two full runs), nearly all of it the two 5.25M-state passes. A VIOLATION expected in the matrix is either a deliberate break, a tolerated property, or the confirmed finding F1; the matrix is a record of what is known, not a gate that hides F1.

**Verdicts.** `check.sh` gives each run PASS (whole bounded space explored, no violation), VIOLATION (invariant or deadlock, TLC exit 12 or 11, shortest path saved), INCOMPLETE (stopped by the `--timeout` wall-clock budget, default 300s) or TOOLING (anything else: parse error, bad config, crash, checksum mismatch, missing Java). Its exit status is 0 when every verdict matches `EXPECT`, 1 on a mismatch, 3 on incomplete exploration and 2 on a tooling failure; the worst wins. All four were seen during the pilot: a missing `>` in the spec gave TOOLING on every row, and the first unreduced model hit the budget and gave INCOMPLETE.

**Drift.** `check.sh` records the sync commit `1555214d4317494b1c9314b5c72eb9c484ffe8b9` and the covered files (`completion-write-queue.ts`, `completion-write-storage.ts`, `completion-write-hook.ts`, `completion-write-timing.ts`, `pkg/plugin/completion_records_write.go`). When any of them differs from the sync commit, it prints a `DRIFT:` warning naming them. TLC never reads TypeScript, so this warning is the only link from a code change to the model.

## Defects

### F1 (confirmed, low severity): a reset in one tab does not stop another tab's in-flight record from coming back

The shortest counterexample in `task` mode, as pstack's `/statechart` report tells it (`results/statechart/two-tabs/report.md`):

1. A guide is completed in Tab A; its record is queued.
2. Tab A's drain takes the lease, renews it and sends the record.
3. While Tab A waits for the server, the reader resets all progress in Tab B. Tab B's `clear()` removes every item key and the lease (`completion-write-storage.ts:114-119`).
4. Tab A's request fails or times out. Its re-put is guarded only by Tab A's own in-memory `items` (`completion-write-queue.ts:351-353`), which still holds the record, so `storage.put` (`:356`) writes the withdrawn record back.

Reset listeners are in-process only (`guide-attempts.ts:42-53`), so nothing tells Tab A. The vanished-lease check stops Tab A before its next send (`completion-write-storage.ts:148`), but the re-put of the item already in flight has no such check. The same tab is protected: `p1-one-tab` passes, matching the existing test "does not re-persist an item cleared while its POST was in flight".

A second path: after any outcome for the in-flight item, Tab A visits a queued partial while backend capability is `unknown` and puts it back with no lease or storage check (`completion-write-queue.ts:291-295`).

**Reproduced** with the real queue and the real storage adapter over jsdom `localStorage`, one adapter per tab, in `src/completion-records/completion-write-queue.cross-tab-reset.test.ts`:

- the in-flight completion is back in storage after a transient outcome;
- a later drain in Tab B POSTs the withdrawn completion (its key is sent once more after the reset);
- a held partial is back in storage after the in-flight POST resolves.

Each case asserts the contract and is marked `it.failing`, so it passes while the defect exists and fails once it is fixed. All three were first run as plain `it` and failed on the contract assertion itself, not on setup.

**Harm.** After "reset all learning progress" (`MyLearningTab.tsx:494`) a completion that was in flight in another tab of the same user, and whose POST then failed transiently, is sent again and recorded. The reset contract is that a reset cannot be followed by the queue draining records for the guides just cleared (`completion-write-hook.ts:339-343`), and `queue-eviction-concurrency` says no outcome re-persists a record that left the queue mid-send. The window is narrow: two tabs, a reset during one POST (bounded by `WRITE_REQUEST_TIMEOUT_MS`, 20s), and a transient outcome. The partial path probably self-heals in the product. By code reading (not reproduced): `clearAllAttempts` removes the attempts from shared `localStorage` (`guide-attempts.ts:266-286`), so `isAttemptCurrent` (`completion-write-hook.ts:101`) is false at the next drain and the partial is dropped before sending (`completion-write-queue.ts:278-280`). The model has no attempt currency, so it reports both paths alike.

Not fixed here: product code is out of scope for the pilot.

### Trial implementation change: exposing a partial fix and model drift

To see how the model reacts to an implementation change, a plausible fix was tried in the real code and in the model.

Trial fix A (real code, reverted before committing):

```diff
-      if (!items.some((i) => i.id === item.id)) {
+      // PILOT TRIAL CHANGE (#2421): also skip the re-put once the lease is gone. Never commit.
+      if (!items.some((i) => i.id === item.id) || !storage.renewLease(now())) {
         continue;
       }
```

- Real code: all 395 existing completion-records tests still passed. Of the three reproduction cases, the two transient-path cases flipped (their `it.failing` now failed because the contract held), and the held-partial case still broke the contract.
- Model, before any update: `p1-cross-tab-task` still reported the same violation, because TLC does not read the code. `check.sh` printed `DRIFT: covered code changed since sync commit 1555214d43 … completion-write-queue.ts`. That warning is the only thing that exposed the drift.
- Model, updated to describe fix A (`fixTransientOnly`): still a violation, now through the held-partial path (`fix-transient-only`, 14 steps). This matched the real-code result above before it was run.
- Fix B (`fixBoth`, model only: also check the lease before the held-partial put) passes P1 and P3 in `task` mode, and still breaks P1 in `op` mode (`fix-both-op`, 9 steps) through the window between the lease read and the put. A check-then-put on `localStorage` cannot be atomic; under task-consistent storage the window closes, otherwise it only narrows. A complete fix probably needs the reader side to ignore stale records, for example a reset generation stamped into each item. That is a design question for a follow-up, not settled here.

### No other defects

P2 and P3 hold over the full bounded space (5.25M states, two tabs, lease expiry at any time, non-atomic lease). T1 fails as expected in two ways. With per-call interleaving, two tabs can both read an empty lease, both write and both read back their own value, then both renew and send, with no lease expiry at all (`t1-send-race-no-expiry`, 18 steps). In `task` mode it takes a lease expiry during a send (`t1-send-task-expiry`). The code comments describe duplicate POSTs only as a lease-expiry effect (`completion-write-timing.ts:28-36`, `completion-write-queue.ts:302-308`); the model shows the acquire race is a second source. Both are covered by the dedup backstop, and that backstop exists (record name from the key, 409 as success).

## Real-code mutation check

Each mutation was applied to `src/completion-records/completion-write-queue.ts`, `npx jest src/completion-records --coverage=false` was run (21 suites, 395 tests), and the file was restored with `git checkout`.

| Mutation                                                                                                 | Model counterpart                     | Existing tests                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the membership re-check before the transient re-put (lines 351-353)                               | `noMembershipCheck`, P1 one tab fails | 3 fail, including "does not re-persist an item cleared while its POST was in flight"                                                                                                                          |
| Key always `${item.id}-${item.attempts}` (line 309)                                                      | `retryKey`, P2 fails                  | 6 fail (wire format and key equality tests)                                                                                                                                                                   |
| Key changes only on retries: `item.attempts > 0 ? \`${item.id}-r${item.attempts}\` : item.id` (line 309) | `retryKey`, P2 fails                  | **All 395 pass.** No test sends a retry and compares its key with the first send's key. The model's P2 states exactly this property, but it only catches the break if the model is updated to match the code. |

```diff
-      if (!items.some((i) => i.id === item.id)) {
-        continue;
-      }
+      // PILOT THROWAWAY MUTATION (#2421): membership re-check removed. Never commit.
       item.attempts += 1;
```

```diff
-        outcome = await send(item.body, item.id);
+        // PILOT THROWAWAY MUTATION (#2421): key changes only on retries. Never commit.
+        outcome = await send(item.body, item.attempts > 0 ? `${item.id}-r${item.attempts}` : item.id);
```

## Rerun and maintain

```bash
formal/completion-queue/check.sh                       # full matrix, ~3.5 min
formal/completion-queue/check.sh --only p1-cross-tab-task
formal/completion-queue/statechart.sh                  # pstack charts and reports for the small configs
npx jest src/completion-records/completion-write-queue.cross-tab-reset.test.ts --coverage=false
```

When a covered file changes, `check.sh` prints `DRIFT:`. Then re-read the diff against the action table above, update the model so each action again matches its code, rerun, and treat a new violation as a bug candidate until a step-by-step replay against the real code shows it cannot happen. Move `SYNC_COMMIT` forward only after that review. Change an invariant only when the promise changed on purpose, with the evidence cited. When F1 is fixed, the three `it.failing` cases fail; turn them into `it` and set `p1-cross-tab-task`'s expected verdict to PASS only if the model of the fixed code passes.

## Maintenance burden

About 350 lines of TLA+, 245 lines of shell, 60 lines of view, and a 150-line test. The model must be updated by hand on any change to the drain loop, the lease, or reset. TLC needs Java, which the repo does not otherwise need. The pstack statechart needs a recent Node and network access the first time. The bounds are close to the edge: a third event (`c1 c2 p1`, two tabs, `op`, `NoSilentLoss`) was still INCOMPLETE after 240s, with 12.5M distinct states and 2.9M left on the queue. A third tab was not tried.

## Value over existing tests

- Found F1, a real cross-tab case of a contract the suite tests only within one tab. A targeted test for it was cheap once the path was known; finding the path was the value.
- Checked a plausible fix before it was written, and showed it was incomplete (held-partial path), and that per-call storage interleaving leaves a window under any check-then-put fix.
- Showed that the lease does not give mutual exclusion even without expiry under per-call interleaving, which the code comments do not say.
- Pointed to a test gap: a retry-only key change passes every existing test.
- Did not find anything for P2 or P3 that the existing tests miss in the current code.

## Recommendation: narrow

Keep the model and `check.sh` as an off-main, manual tool for changes to the drain loop, lease or reset, and add no CI job. Take the deterministic outputs to main instead: a fix for F1 with the three reproduction cases as ordinary tests, and a test that a retried POST reuses the first key. Revisit a non-blocking CI job only if the queue protocol keeps changing, since the model's value depends on someone keeping it in step with the code by hand.
