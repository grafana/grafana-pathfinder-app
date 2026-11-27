-------------------------- MODULE ResetAndReenqueue --------------------------
EXTENDS Naturals
CONSTANT SkipGuard
Tabs == {"A", "B"}
Events == {"old", "new"}
Key(e) == IF e = "old" THEN "old-key" ELSE "new-key"
VARIABLES stage, disk, memory, flight, newLive, oldResponded, sent
vars == <<stage, disk, memory, flight, newLive, oldResponded, sent>>

Init ==
    /\ stage = "ready"
    /\ disk = {"old"}
    /\ memory = [t \in Tabs |-> IF t = "A" THEN {"old"} ELSE {}]
    /\ flight = [t \in Tabs |-> "none"]
    /\ newLive = FALSE /\ oldResponded = FALSE /\ sent = {}

SendOld ==
    /\ stage = "ready"
    /\ flight' = [flight EXCEPT !["A"] = "old"]
    /\ sent' = sent \cup {<<"old", Key("old")>>}
    /\ stage' = "pending-old"
    /\ UNCHANGED <<disk, memory, newLive, oldResponded>>

Reset(t) ==
    /\ stage = "pending-old"
    /\ disk' = {}
    /\ memory' = [memory EXCEPT ![t] = {}]
    /\ stage' = "reset"
    /\ UNCHANGED <<flight, newLive, oldResponded, sent>>

EnqueueNew ==
    /\ stage = "reset"
    /\ disk' = disk \cup {"new"}
    /\ memory' = [memory EXCEPT !["B"] = @ \cup {"new"}]
    /\ newLive' = TRUE
    /\ stage' = "new-queued"
    /\ UNCHANGED <<flight, oldResponded, sent>>

SendNew ==
    /\ stage = "new-queued"
    /\ flight' = [flight EXCEPT !["B"] = "new"]
    /\ sent' = sent \cup {<<"new", Key("new")>>}
    /\ stage' = "both-pending"
    /\ UNCHANGED <<disk, memory, newLive, oldResponded>>

OldResponse(success) ==
    /\ stage \in {"new-queued", "both-pending", "new-retry", "new-done"}
    /\ ~oldResponded
    /\ disk' = IF success THEN disk \ {"old"}
                ELSE IF "old" \in memory["A"] \/ SkipGuard THEN disk \cup {"old"} ELSE disk
    /\ memory' = IF success THEN [memory EXCEPT !["A"] = @ \ {"old"}] ELSE memory
    /\ flight' = [flight EXCEPT !["A"] = "none"]
    /\ oldResponded' = TRUE
    /\ UNCHANGED <<stage, newLive, sent>>

NewResponse(success) ==
    /\ stage = "both-pending"
    /\ disk' = IF success THEN disk \ {"new"} ELSE disk \cup {"new"}
    /\ memory' = IF success THEN [memory EXCEPT !["B"] = @ \ {"new"}] ELSE memory
    /\ flight' = [flight EXCEPT !["B"] = "none"]
    /\ newLive' = ~success
    /\ stage' = IF success THEN "new-done" ELSE "new-retry"
    /\ UNCHANGED <<oldResponded, sent>>

RetryNew ==
    /\ stage = "new-retry"
    /\ flight' = [flight EXCEPT !["B"] = "new"]
    /\ sent' = sent \cup {<<"new", Key("new")>>}
    /\ stage' = "both-pending"
    /\ UNCHANGED <<disk, memory, newLive, oldResponded>>

Next == SendOld \/ EnqueueNew \/ SendNew \/ RetryNew
    \/ \E t \in Tabs : Reset(t)
    \/ \E success \in BOOLEAN : OldResponse(success) \/ NewResponse(success)

ASSUME Key("old") # Key("new")
StableKeys == \A pair \in sent : pair[2] = Key(pair[1])
NewSurvivesOld == ~newLive \/ "new" \in disk
OldStaysWithdrawn == ~oldResponded \/ "old" \notin disk
=============================================================================
