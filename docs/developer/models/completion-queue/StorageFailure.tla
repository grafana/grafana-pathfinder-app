---------------------------- MODULE StorageFailure ----------------------------
EXTENDS Naturals
CONSTANT DropPreviousOnFailure
Half == "attempt-50"
Full == "attempt-100"
VARIABLES stage, disk, memory, volatile, accepted, lastPutFailed, reloaded
vars == <<stage, disk, memory, volatile, accepted, lastPutFailed, reloaded>>

Init ==
    /\ stage = "ready"
    /\ disk = {Half} /\ memory = {Half} /\ volatile = {}
    /\ accepted = FALSE /\ lastPutFailed = FALSE /\ reloaded = FALSE

PutReplacementSuccess ==
    /\ stage = "ready"
    /\ disk' = {Full}
    /\ memory' = {Full}
    /\ volatile' = {}
    /\ accepted' = TRUE /\ lastPutFailed' = FALSE
    /\ stage' = "written"
    /\ UNCHANGED reloaded

PutReplacementFailure ==
    /\ stage = "ready"
    /\ disk' = IF DropPreviousOnFailure THEN {} ELSE disk
    /\ volatile' = {Full}
    /\ accepted' = FALSE /\ lastPutFailed' = TRUE
    /\ stage' = "failed"
    /\ UNCHANGED <<memory, reloaded>>

Refresh ==
    /\ stage = "failed"
    /\ memory' = disk \cup volatile
    /\ stage' = "refreshed"
    /\ UNCHANGED <<disk, volatile, accepted, lastPutFailed, reloaded>>

DuplicateFull ==
    /\ stage = "refreshed" /\ Full \in memory
    /\ accepted' = TRUE
    /\ stage' = "duplicate"
    /\ UNCHANGED <<disk, memory, volatile, lastPutFailed, reloaded>>

Reload ==
    /\ stage \in {"written", "failed", "refreshed", "duplicate"} /\ ~reloaded
    /\ memory' = disk
    /\ volatile' = {}
    /\ reloaded' = TRUE
    /\ stage' = "reloaded"
    /\ UNCHANGED <<disk, accepted, lastPutFailed>>

Next == PutReplacementSuccess \/ PutReplacementFailure \/ Refresh \/ DuplicateFull \/ Reload

DurableAcceptance == ~accepted \/ Full \in disk
FailedReplacementPreservesOld == ~lastPutFailed \/ Half \in disk
ReloadMatchesDisk == ~reloaded \/ memory = disk
ASSUME Half # Full
=============================================================================
