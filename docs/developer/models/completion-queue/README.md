# Completion queue model-checking pilot

Can two tabs retry a completion after lease expiry and reset while preserving its original key and keeping withdrawn records out of shared storage? Can a second engineer replay the ordering and update the model?

The local contract protects a response handled by the queue instance that was cleared. A stronger, owner-wide interpretation also covers a response handled by another tab. Check those scopes separately: each queue has its own in-memory membership guard.

## Contract and code mapping

Mapping baseline: `7f63aa476700683e40131ff29a558dbe12b37328`. The model starts just after two successful enqueues of distinct, due terminal events. An event identifies a logical completion. Its stored row also has an id, the original idempotency key. The numbers are synthetic.

| Model action or property | [Queue](../../../../src/completion-records/completion-write-queue.ts) and [storage adapter](../../../../src/completion-records/completion-write-storage.ts)                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read, Write, Verify      | Three separately schedulable steps of `acquireLease`: inspect the owner/expiry, write the candidate, reread the holder. Two readers can both advance to Write. A failed read can wait without changing state.  |
| Expire                   | The stored timestamp has passed. The holder remains visible until overwritten or removed.                                                                                                                      |
| Send                     | `processDue` refreshes from `list`; `processDueWithLease` renews, pins the row and calls `send(item.body, item.id)`. A pending response can outlive takeover. `sent` records observed event/key pairs.         |
| Reset                    | One queue's `clear` empties its local items and calls storage.clear, sweeping the shared prefix including its lease. The peer retains its own memory. Submitted writes remain in flight.                       |
| Transient, Release       | The responding queue checks local membership, mutates retry metadata and puts the captured row. The pass finally calls `releaseLease` if still holder. `member` tracks local membership for the held row only. |
| StableKey                | Every observed send, including a re-POST by a different tab, carries that event's enqueue-time id.                                                                                                             |
| LocalWithdrawal          | A transient for a submission pending in the clearing instance at reset must skip the put. `withdrawn` independently records that pending submission; `badPut` remembers any forbidden put.                     |
| OwnerWithdrawal          | After reset the owner prefix must contain no rows, including after a peer's pending response. With no fresh enqueues this expresses the stronger shared-storage requirement.                                   |

**Bounds and omissions of the original model.** Two tabs, one owner, two initially durable events, at most one pending send per tab and one reset anywhere. Repeated passes and expiries revisit a finite graph. Each pass selects one due row; either row may be eligible. Retry timing, attempts and row ordering are abstracted. Only transient responses are explored. The replay also uses success to finish one pending call. The response can be delayed by a suspended tab regardless of the normal request timeout. Renewal, selection/send, release and the reset sweep each group storage operations; races inside those groups and time passing during acquisition are outside coverage. Storage succeeds. Volatile fallback, partials, cap/retention, identity changes, hook scheduling, tab crashes, new enqueues and the backend are outside this original model. There is no fairness condition. A reset cannot undo a submitted write. Delivery and server deduplication require separate evidence.

## Repeat the check

Use Java (tested with 27.0.1.1) and the official v1.8.0 TLC jar. From this directory, run in a shell:

```sh
work=$(mktemp -d)
jar="$work/tla2tools.jar"
curl -fLsS https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar -o "$jar" &&
  echo "67f9575c3b9ef7a0787b1bded34812862ffe79d711298e5a75b1a77720b19928  $jar" | shasum -a 256 -c - || exit 1
check() {
  java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 -fp 0 -noGenerateSpecTE \
    -metadir "$work/states-$1" -config "$1.cfg" CompletionQueue
}
check Clean
check Fault
check Owner
```

Read each invocation separately. A complete pass needs exit 0, TLC's no-error completion message and zero states left. A named invariant violation with a state trace is a counterexample (exit 12 here). A timeout, interruption or resource limit before completion is incomplete. A failed checksum, missing Java, parser error or ill-defined successor is a tooling/model error. None of those outcomes establishes a pass. The check runs on demand.

| Configuration | Result                                              | Generated / distinct / queued at stop | Depth | Wall time |
| ------------- | --------------------------------------------------- | ------------------------------------- | ----- | --------- |
| Clean         | Exhausted graph; StableKey and LocalWithdrawal held | 6,101 / 2,158 / 0                     | 25    | 0.42 s    |
| Fault         | SkipGuard enabled; LocalWithdrawal violated         | 202 / 114 / 49                        | 7     | 0.47 s    |
| Owner         | Unmodified transitions; OwnerWithdrawal violated    | 208 / 118 / 51                        | 7     | 0.38 s    |

Times include JVM startup on Apple silicon. Only the first row describes exhaustive coverage.

## Three bounded extensions

These are separate small state spaces, in the proposed order, rather than one combined state space. They use the same queue and storage mapping above. A clean result applies only to the transitions named in its row.

| Step and model                                     | Source mapping                                                                                                                                                                                                                                                                                                                  | Checked rule and result                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reset then complete again: `ResetAndReenqueue.tla` | A submits the old row; either tab resets; B enqueues a new row for the same guide with a distinct id; both pending responses may be success or transient. A retry submits the new row's stored id.                                                                                                                              | `StableKeys` and `NewSurvivesOld` hold. `OldStaysWithdrawn` fails when B resets and A's late transient re-persists the old row beside the new row. This is the existing owner-wide weakness in a new-completion schedule. |
| Partial progress: `PartialProgress.tla`            | A submits 50%; B may refresh and queue the same 50% under the same attempt id, then queues 100% while A waits. B removes its known predecessor only after putting 100%; A's later response may succeed or be transient.                                                                                                         | `FullSurvivesHalf` and `SamePercentageSameKey` hold. A late 50% response may restore 50%, but it does not remove 100%.                                                                                                    |
| Storage failure and reload: `StorageFailure.tla`   | A holds durable 50%. A replacement `put` for 100% succeeds or fails once. After failure, `processDue` refreshes from the adapter's volatile overlay and holds the 100% send; another enqueue of 100% finds it in queue memory, checks `isDurable`, and retries the `put`, which succeeds or fails. Reload drops volatile state. | `DurableAcceptance`, `FailedReplacementPreservesOld` and `ReloadMatchesDisk` hold. Before the fix, the duplicate reported success without a write, and `DurableAcceptance` failed at state 4.                             |

From the same directory, reuse the verified `jar` and `work` variables above:

```sh
check_extension() {
  config=$1
  module=$2
  java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers 1 -fp 0 -deadlock -noGenerateSpecTE \
    -metadir "$work/states-$config" -config "$config.cfg" "$module"
}
check_extension ResetAndReenqueue ResetAndReenqueue
check_extension ResetAndReenqueueOwner ResetAndReenqueue
check_extension PartialProgress PartialProgress
check_extension PartialProgressFault PartialProgress
check_extension StorageFailure StorageFailure
check_extension StorageFailureAcceptance StorageFailure
check_extension StorageFailureFault StorageFailure
```

`-deadlock` disables TLC's deadlock check because these finite schedules intentionally end. It does not disable the listed invariants. The owner configuration is expected to exit 12 with a counterexample. The partial and storage fault configurations deliberately remove the 100% row and the previous durable row, respectively; each must exit 12 on its named invariant. The four clean configurations must exit 0 with no error and zero queued states.

| Configuration            | Generated / distinct / queued at stop | Depth | Outcome                                                                   |
| ------------------------ | ------------------------------------- | ----- | ------------------------------------------------------------------------- |
| ResetAndReenqueue        | 62 / 20 / 0                           | 7     | Exhausted graph; both invariants held                                     |
| ResetAndReenqueueOwner   | 13 / 10 / 3                           | 5     | Counterexample: B reset, B enqueued new, A's old transient restored old   |
| PartialProgress          | 16 / 11 / 0                           | 5     | Exhausted graph; both invariants held                                     |
| PartialProgressFault     | 11 / 8 / 2                            | 4     | Injected fault violated `FullSurvivesHalf`                                |
| StorageFailure           | 11 / 8 / 0                            | 4     | Exhausted graph; predecessor and reload invariants held                   |
| StorageFailureAcceptance | 11 / 8 / 0                            | 4     | Exhausted graph; all three invariants held, including `DurableAcceptance` |
| StorageFailureFault      | 3 / 3 / 1                             | 2     | Injected fault violated `FailedReplacementPreservesOld`                   |

The [focused implementation replay](../../../../src/completion-records/completion-write-queue.takeover.test.ts) holds the old or partial send while the other queue changes storage. It checks reset and re-completion, both late 50% outcomes, deterministic attempt keys, a failed replacement followed by a fresh storage adapter simulating reload, and a duplicate enqueue after volatile refresh, both while storage still rejects the write and after it recovers. The owner-wide case asserts a current limitation, not desired behavior. Run it with the focused Jest command above; the four focused queue and adapter suites passed with 82 tests after the durable-duplicate fix.

These extensions abstract the lease steps, retry delay, partial capability check, backoff metadata, storage-event timing and server effects. The storage-failure model has one replacement write, one duplicate retry of that write and one reload; it does not combine a failed write with a concurrent reset or response. The passing invariants therefore do not establish those unmodeled combinations.

## Read and replay a trace

Both shortest counterexamples start with A reading an available lease, writing A, verifying A, then submitting event 1 with key 11. The row remains on disk until reset. Compare TLC states 5–7:

| Configuration | Reset while A waits                                        | A receives transient                               | What failed                                   |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Fault         | A clears. Disk is empty and A no longer has the row.       | The injected guard bypass writes the captured row. | A's own pending response resurrects event 1.  |
| Owner         | B clears. Disk is empty but A still has the row in memory. | The real local check permits the put.              | A peer's pending response resurrects event 1. |

The shortest traces need no expiry. The [implementation replay](../../../../src/completion-records/completion-write-queue.takeover.test.ts) adds takeover, which lets both callbacks hold the same row. From the repo root:

```sh
npm run test:ci -- --coverage=false --runTestsByPath src/completion-records/completion-write-queue.takeover.test.ts
```

The original replay holds A's response, verifies B cannot send before expiry, advances the injected clock past the TTL, and observes B submit the original key. B clears, then receives a transient. The real adapter lists an empty queue. A receives success and the queue stays empty. The four focused queue/adapter suites passed at the pilot baseline (73 tests).

**Mutation check.** In a disposable checkout, remove only the membership check immediately before `item.attempts += 1` in `processDueWithLease`. Run the replay: the first post-clear storage assertion failed with id `original-key` and attempts 1. Restore the guard. TLC's Clean run is independent of that edit; the model must be kept in sync by hand.

**Unmodified implementation finding.** With the guard restored, change only A's final response in the replay from `created` to `transient`. The earlier empty-storage assertion passed; the final one failed with the same id and attempts 1. Thus a peer can re-persist a withdrawn row with the original key. This confirms queue/adapter behavior for the held-response schedule. Frequency under the browser's real timeout and impact on a server record remain open. Both experimental edits were reverted. [PR #2480](https://github.com/grafana/grafana-pathfinder-app/pull/2480) motivated looking at reset ordering in an adjacent path.

## Maintaining the pilot

**Recommendation: narrow.** Keep this a manual investigation for changes to shared queue membership or lease handling. The new evidence is the difference between two outstanding responses to the same key after a reset. The existing separate lease-expiry and local-clear tests do not observe that distinction.

On a queue change, diff the two mapped source files from the baseline, identify the storage reads/writes and suspension points that moved, and update the matching actions and replay together. In particular, splitting renewal or changing which tab observes a withdrawal can invalidate the abstraction. Revisit grouping before interpreting a clean check. Rerun all configurations, record counts and the first divergent state, then rerun the real-code replay and its negative control. Review any property change separately and advance the baseline once the mapping agrees.

For a second subsystem, start with one contested resource, two actors and an observable safety property. Write down which operations can interleave, inject one wrong decision, and hold the corresponding real callback in a deterministic test. This pilot now has four small models, ten configurations and one focused replay suite; each TLC run took under a second. Independent reproduction by a second engineer and the cost of keeping a second mapping current remain unmeasured.
