--------------------------- MODULE CompletionQueue ---------------------------
(***************************************************************************)
(* Bounded model of the durable completion write queue shared by several   *)
(* browser tabs of one (user, org) owner. Pilot for issue #2421.           *)
(*                                                                         *)
(* Code: src/completion-records/completion-write-queue.ts (queue),         *)
(*       src/completion-records/completion-write-storage.ts (localStorage  *)
(*       adapter and lease), src/completion-records/completion-write-hook.ts *)
(*       (one drain at a time per tab, reset entry point).                 *)
(* docs/developer/PSTACK_PILOT.md maps each action to file:line and names  *)
(* the sync commit.                                                        *)
(*                                                                         *)
(* Granularity "op": each localStorage getItem / setItem / removeItem is    *)
(* one step, so the lease is read / write / read-back and never atomic.    *)
(* Granularity "task": other tabs step only while this tab awaits.         *)
(* Either way a tab's own enqueue or reset can only run while its drain is *)
(* idle or awaiting the POST (the only await inside processDue).           *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
    Tabs,          \* browser tabs of one owner
    Events,        \* queue ids (stable idempotency keys)
    Partials,      \* subset of Events that are partial attempt writes
    MaxAttempts,   \* retry counter saturates here (abstraction, see write-up)
    AllowExpiry,   \* TRUE: the lease TTL may pass at any moment
    AllowClear,    \* TRUE: a tab may run "reset all" (queue.clear)
    Granularity,   \* "op" or "task", see the header
    Variant        \* "none" = current code; others are deliberate breaks

ASSUME Partials \subseteq Events
ASSUME MaxAttempts \in Nat
ASSUME Granularity \in {"op", "task"}
ASSUME Variant \in {"none", "noMembershipCheck", "retryKey", "dropOnTransient",
                    "fixTransientOnly", "fixBoth"}

(* Trial fixes for the cross-tab reset finding: re-check that this tab   *)
(* still holds the lease before the transient re-put, and with fixBoth   *)
(* also before the held-partial put. The check is a read, and the put a  *)
(* later step.                                                           *)
FixTransient == Variant \in {"fixTransientOnly", "fixBoth"}
FixHold      == Variant = "fixBoth"

None    == "none"
Absent  == -1
NoLease == [holder |-> None, live |-> FALSE]
Att     == 0..MaxAttempts

VARIABLES
    store,          \* shared localStorage item keys: event -> attempts, or Absent
    lease,          \* shared localStorage lease key
    wire,           \* idempotency keys of POSTs the server may still apply
    records,        \* keys the server committed; a set, so dedup is assumed
    pc,             \* per tab: where its drain is
    items,          \* per tab: ids in the in-memory queue (`items`)
    snap,           \* per tab: attempts of the item objects loaded by refresh()
    due,            \* per tab: ids of this pass's `due` snapshot not yet visited
    cur,            \* per tab: id being renewed for / sent
    leasePersisted, \* per tab: storage adapter's `leasePersisted`
    enqBy,          \* ghost: ids each tab has enqueued
    cleared         \* ghost: ids withdrawn by a reset

vars == <<store, lease, wire, records, pc, items, snap, due, cur,
          leasePersisted, enqBy, cleared>>

Enqueued == UNION {enqBy[t] : t \in Tabs}

Key(e, a) == IF Variant = "retryKey" THEN <<e, a>> ELSE <<e, 0>>
Inc(a)    == IF a < MaxAttempts THEN a + 1 ELSE MaxAttempts
HeldBy(t) == lease.holder = t
Stored    == {e \in Events : store[e] # Absent}

PCs == {"idle", "acqRead", "acqWrite", "acqCheck", "next",
        "renRead", "renWrite", "renCheck", "inflight", "relRead", "relRemove",
        "rePut", "holdPut"}

TypeOK ==
    /\ store \in [Events -> {Absent} \cup Att]
    /\ lease \in [holder : Tabs \cup {None}, live : BOOLEAN]
    /\ wire \subseteq (Events \X Att)
    /\ records \subseteq (Events \X Att)
    /\ pc \in [Tabs -> PCs]
    /\ items \in [Tabs -> SUBSET Events]
    /\ snap \in [Tabs -> [Events -> {Absent} \cup Att]]
    /\ due \in [Tabs -> SUBSET Events]
    /\ cur \in [Tabs -> Events \cup {None}]
    /\ leasePersisted \in [Tabs -> BOOLEAN]
    /\ enqBy \in [Tabs -> SUBSET Events]
    /\ cleared \subseteq Events

Init ==
    /\ store = [e \in Events |-> Absent]
    /\ lease = NoLease
    /\ wire = {}
    /\ records = {}
    /\ pc = [t \in Tabs |-> "idle"]
    /\ items = [t \in Tabs |-> {}]
    /\ snap = [t \in Tabs |-> [e \in Events |-> Absent]]
    /\ due = [t \in Tabs |-> {}]
    /\ cur = [t \in Tabs |-> None]
    /\ leasePersisted = [t \in Tabs |-> FALSE]
    /\ enqBy = [t \in Tabs |-> {}]
    /\ cleared = {}

Between(t) == pc[t] \in {"idle", "inflight"}
CanRun(t)  == Granularity = "op" \/ \A u \in Tabs \ {t} : Between(u)
At(t, p)   == CanRun(t) /\ pc[t] = p
Goto(t, p) == pc' = [pc EXCEPT ![t] = p]

(* enqueue(): storage.put(item), then items.push(item). A completion id is  *)
(* fresh, so one tab enqueues it. An attempt id `${attemptId}-${percent}`  *)
(* can be enqueued by two tabs. A reset mints a new attempt, so a cleared  *)
(* id is never enqueued again.                                             *)
Enqueue(t, e) ==
    /\ CanRun(t)
    /\ Between(t)
    /\ e \notin enqBy[t]
    /\ e \in Partials \/ e \notin Enqueued
    /\ e \notin cleared
    /\ store' = [store EXCEPT ![e] = 0]
    /\ items' = [items EXCEPT ![t] = @ \cup {e}]
    /\ enqBy' = [enqBy EXCEPT ![t] = @ \cup {e}]
    /\ UNCHANGED <<lease, wire, records, pc, snap, due, cur, leasePersisted, cleared>>

(* clear() via discardQueuedCompletionWrites or onAttemptReset(null): this *)
(* tab's memory plus every key under the owner prefix, lease included.     *)
(* Other tabs are not told: reset listeners are in-process only.           *)
Reset(t) ==
    /\ AllowClear
    /\ CanRun(t)
    /\ Between(t)
    /\ Enqueued \ cleared # {}
    /\ items' = [items EXCEPT ![t] = {}]
    /\ store' = [e \in Events |-> Absent]
    /\ lease' = NoLease
    /\ cleared' = Enqueued
    /\ UNCHANGED <<wire, records, pc, snap, due, cur, leasePersisted, enqBy>>

(* drain() timer fires; `draining` allows one processDue per tab. *)
StartDrain(t) ==
    /\ At(t, "idle")
    /\ Goto(t, "acqRead")
    /\ UNCHANGED <<store, lease, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* acquireLease: read the lease key. *)
AcqRead(t) ==
    /\ At(t, "acqRead")
    /\ Goto(t, IF lease.holder \notin {None, t} /\ lease.live THEN "idle" ELSE "acqWrite")
    /\ UNCHANGED <<store, lease, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* acquireLease: write our candidate. *)
AcqWrite(t) ==
    /\ At(t, "acqWrite")
    /\ lease' = [holder |-> t, live |-> TRUE]
    /\ Goto(t, "acqCheck")
    /\ UNCHANGED <<store, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* acquireLease: read back. On success refresh() reloads memory from      *)
(* storage and processDueWithLease takes its `due` snapshot.              *)
AcqCheck(t) ==
    /\ At(t, "acqCheck")
    /\ leasePersisted' = [leasePersisted EXCEPT ![t] = HeldBy(t)]
    /\ IF HeldBy(t)
       THEN /\ items' = [items EXCEPT ![t] = Stored]
            /\ snap' = [snap EXCEPT ![t] = store]
            /\ due' = [due EXCEPT ![t] = Stored]
            /\ Goto(t, "next")
       ELSE /\ Goto(t, "idle")
            /\ UNCHANGED <<items, snap, due>>
    /\ UNCHANGED <<store, lease, wire, records, cur, enqBy, cleared>>

(* Loop head of processDueWithLease. An id no longer in memory is skipped. *)
(* A partial may be held while capability is 'unknown': storage.put(item)  *)
(* with no lease renewal and no membership re-check.                       *)
NextItem(t) ==
    /\ At(t, "next")
    /\ IF due[t] = {}
       THEN /\ Goto(t, "relRead")
            /\ UNCHANGED <<store, due, cur>>
       ELSE \E e \in due[t] :
              /\ due' = [due EXCEPT ![t] = @ \ {e}]
              /\ IF e \notin items[t]
                 THEN UNCHANGED <<store, pc, cur>>
                 ELSE \/ /\ Goto(t, "renRead")
                         /\ cur' = [cur EXCEPT ![t] = e]
                         /\ UNCHANGED store
                      \/ /\ e \in Partials
                         /\ ~FixHold
                         /\ store' = [store EXCEPT ![e] = snap[t][e]]
                         /\ UNCHANGED <<pc, cur>>
                      \/ /\ e \in Partials
                         /\ FixHold
                         /\ IF HeldBy(t)
                            THEN /\ Goto(t, "holdPut")
                                 /\ cur' = [cur EXCEPT ![t] = e]
                            ELSE UNCHANGED <<pc, cur>>
                         /\ UNCHANGED store
    /\ UNCHANGED <<lease, wire, records, items, snap, leasePersisted, enqBy, cleared>>

(* renewLease: read. A lease held by another tab, or one this tab wrote    *)
(* that has vanished, stops the drain (then `finally` releases).           *)
RenRead(t) ==
    /\ At(t, "renRead")
    /\ Goto(t, IF lease.holder \notin {None, t} \/ (lease.holder = None /\ leasePersisted[t])
               THEN "relRead" ELSE "renWrite")
    /\ UNCHANGED <<store, lease, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

RenWrite(t) ==
    /\ At(t, "renWrite")
    /\ lease' = [holder |-> t, live |-> TRUE]
    /\ Goto(t, "renCheck")
    /\ UNCHANGED <<store, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* renewLease: read back. On success the POST leaves with key item.id. *)
SendPost(t) ==
    /\ At(t, "renCheck")
    /\ leasePersisted' = [leasePersisted EXCEPT ![t] = HeldBy(t)]
    /\ IF HeldBy(t)
       THEN /\ wire' = wire \cup {Key(cur[t], snap[t][cur[t]])}
            /\ Goto(t, "inflight")
       ELSE /\ Goto(t, "relRead")
            /\ UNCHANGED wire
    /\ UNCHANGED <<store, lease, records, items, snap, due, cur, enqBy, cleared>>

(* The server applies a request at any time, also after the client gave   *)
(* up waiting. A request that is never applied just stays in `wire`.      *)
(* Dedup assumption: records is a set of keys.                            *)
ServerApply(k) ==
    /\ k \in wire
    /\ records' = records \cup {k}
    /\ wire' = wire \ {k}
    /\ UNCHANGED <<store, lease, pc, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* The send resolves 'created' only if the server holds the key. *)
PostCreated(t) ==
    /\ At(t, "inflight")
    /\ Key(cur[t], snap[t][cur[t]]) \in records
    /\ items' = [items EXCEPT ![t] = @ \ {cur[t]}]
    /\ store' = [store EXCEPT ![cur[t]] = Absent]
    /\ Goto(t, "next")
    /\ UNCHANGED <<lease, wire, records, snap, due, cur, leasePersisted, enqBy, cleared>>

(* Timeout, 5xx, network error or a rejecting sender. The re-put is      *)
(* guarded only by this tab's in-memory membership.                      *)
PostTransient(t) ==
    /\ At(t, "inflight")
    /\ LET e == cur[t]
           a == Inc(snap[t][e])
       IN  CASE Variant = "dropOnTransient" ->
                  /\ items' = [items EXCEPT ![t] = @ \ {e}]
                  /\ store' = [store EXCEPT ![e] = Absent]
                  /\ UNCHANGED snap
                  /\ Goto(t, "next")
             [] FixTransient ->
                  /\ Goto(t, IF e \in items[t] /\ HeldBy(t) THEN "rePut" ELSE "next")
                  /\ UNCHANGED <<store, items, snap>>
             [] e \in items[t] \/ Variant = "noMembershipCheck" ->
                  /\ store' = [store EXCEPT ![e] = a]
                  /\ snap' = [snap EXCEPT ![t][e] = a]
                  /\ UNCHANGED items
                  /\ Goto(t, "next")
             [] OTHER ->
                  /\ UNCHANGED <<store, items, snap>>
                  /\ Goto(t, "next")
    /\ UNCHANGED <<lease, wire, records, due, cur, leasePersisted, enqBy, cleared>>

(* Trial fixes only: the put that follows a successful lease check. *)
RePut(t) ==
    /\ At(t, "rePut")
    /\ store' = [store EXCEPT ![cur[t]] = Inc(snap[t][cur[t]])]
    /\ snap' = [snap EXCEPT ![t][cur[t]] = Inc(@)]
    /\ Goto(t, "next")
    /\ UNCHANGED <<lease, wire, records, items, due, cur, leasePersisted, enqBy, cleared>>

HoldPut(t) ==
    /\ At(t, "holdPut")
    /\ store' = [store EXCEPT ![cur[t]] = snap[t][cur[t]]]
    /\ Goto(t, "next")
    /\ UNCHANGED <<lease, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* releaseLease: read, then remove only if ours (two steps). Per-pass     *)
(* locals are dropped here; nothing reads them before the next refresh.   *)
RelRead(t) ==
    /\ At(t, "relRead")
    /\ leasePersisted' = [leasePersisted EXCEPT ![t] = FALSE]
    /\ Goto(t, IF HeldBy(t) THEN "relRemove" ELSE "idle")
    /\ cur' = [cur EXCEPT ![t] = None]
    /\ due' = [due EXCEPT ![t] = {}]
    /\ snap' = [snap EXCEPT ![t] = [e \in Events |-> Absent]]
    /\ UNCHANGED <<store, lease, wire, records, items, enqBy, cleared>>

RelRemove(t) ==
    /\ At(t, "relRemove")
    /\ lease' = NoLease
    /\ Goto(t, "idle")
    /\ UNCHANGED <<store, wire, records, items, snap, due, cur, leasePersisted, enqBy, cleared>>

(* LEASE_TTL_MS passes. Symbolic: the model has no clock. *)
LeaseExpires ==
    /\ AllowExpiry
    /\ lease.live
    /\ lease' = [lease EXCEPT !.live = FALSE]
    /\ UNCHANGED <<store, wire, records, pc, items, snap, due, cur, leasePersisted, enqBy, cleared>>

Next ==
    \/ \E t \in Tabs, e \in Events : Enqueue(t, e)
    \/ \E t \in Tabs : Reset(t)
    \/ \E t \in Tabs : StartDrain(t)
    \/ \E t \in Tabs : AcqRead(t)
    \/ \E t \in Tabs : AcqWrite(t)
    \/ \E t \in Tabs : AcqCheck(t)
    \/ \E t \in Tabs : NextItem(t)
    \/ \E t \in Tabs : RenRead(t)
    \/ \E t \in Tabs : RenWrite(t)
    \/ \E t \in Tabs : SendPost(t)
    \/ \E k \in Events \X Att : ServerApply(k)
    \/ \E t \in Tabs : PostCreated(t)
    \/ \E t \in Tabs : PostTransient(t)
    \/ \E t \in Tabs : RePut(t)
    \/ \E t \in Tabs : HoldPut(t)
    \/ \E t \in Tabs : RelRead(t)
    \/ \E t \in Tabs : RelRemove(t)
    \/ LeaseExpires

Spec == Init /\ [][Next]_vars

TabSymmetry == Permutations(Tabs)

-----------------------------------------------------------------------------
(* P1. A record withdrawn by a reset never comes back into storage.       *)
ClearedStaysCleared == \A e \in cleared : store[e] = Absent

(* P2. Retries and lease takeovers reuse one key, so the server holds at  *)
(*     most one record per event (given the dedup assumption).            *)
OneRecordPerEvent ==
    \A e \in Events : Cardinality({k \in records : k[1] = e}) <= 1

(* P3. An accepted, non-withdrawn record stays in storage until the       *)
(*     server holds it (expiry, eviction and terminal drops not modeled). *)
NoSilentLoss ==
    \A e \in Enqueued \ cleared :
        store[e] # Absent \/ \E k \in records : k[1] = e

(* T1. Tolerated, expected to fail: two tabs POST at the same time. The   *)
(*     design relies on P2's dedup for this, not on the lease.            *)
ExclusiveSend == Cardinality({t \in Tabs : pc[t] = "inflight"}) <= 1
=============================================================================
