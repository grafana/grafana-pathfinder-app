---------------------------- MODULE PartialProgress ----------------------------
EXTENDS Naturals
CONSTANT DropFullOnHalfResponse
Tabs == {"A", "B"}
Half == "attempt-50"
Full == "attempt-100"
VARIABLES stage, disk, memory, duplicateDone, keys, halfResponded
vars == <<stage, disk, memory, duplicateDone, keys, halfResponded>>

Init ==
    /\ stage = "ready"
    /\ disk = {Half}
    /\ memory = [t \in Tabs |-> IF t = "A" THEN {Half} ELSE {}]
    /\ duplicateDone = FALSE
    /\ keys = {<<"A", 50, Half>>}
    /\ halfResponded = FALSE

SendHalf ==
    /\ stage = "ready"
    /\ stage' = "half-pending"
    /\ UNCHANGED <<disk, memory, duplicateDone, keys, halfResponded>>

RefreshB ==
    /\ stage = "half-pending"
    /\ memory' = [memory EXCEPT !["B"] = disk]
    /\ UNCHANGED <<stage, disk, duplicateDone, keys, halfResponded>>

DuplicateHalfB ==
    /\ stage = "half-pending" /\ ~duplicateDone
    /\ disk' = disk \cup {Half}
    /\ memory' = [memory EXCEPT !["B"] = @ \cup {Half}]
    /\ keys' = keys \cup {<<"B", 50, Half>>}
    /\ duplicateDone' = TRUE
    /\ UNCHANGED <<stage, halfResponded>>

EnqueueFullB ==
    /\ stage = "half-pending"
    /\ disk' = (disk \cup {Full}) \ (memory["B"] \cap {Half})
    /\ memory' = [memory EXCEPT !["B"] = (@ \ {Half}) \cup {Full}]
    /\ keys' = keys \cup {<<"B", 100, Full>>}
    /\ stage' = "full-queued"
    /\ UNCHANGED <<duplicateDone, halfResponded>>

HalfResponse(success) ==
    /\ stage = "full-queued" /\ ~halfResponded
    /\ disk' = IF DropFullOnHalfResponse THEN disk \ {Full}
                ELSE IF success THEN disk \ {Half}
                ELSE IF Half \in memory["A"] THEN disk \cup {Half} ELSE disk
    /\ memory' = IF success THEN [memory EXCEPT !["A"] = @ \ {Half}] ELSE memory
    /\ halfResponded' = TRUE
    /\ UNCHANGED <<stage, duplicateDone, keys>>

Next == SendHalf \/ RefreshB \/ DuplicateHalfB \/ EnqueueFullB
    \/ \E success \in BOOLEAN : HalfResponse(success)

FullSurvivesHalf == stage \notin {"full-queued"} \/ Full \in disk
SamePercentageSameKey == \A pair \in keys : pair[2] = 50 => pair[3] = Half
ASSUME Half # Full
=============================================================================
