--------------------------- MODULE CompletionQueue ---------------------------
EXTENDS Naturals
CONSTANT SkipGuard
Tabs == {"A", "B"}
Events == {1, 2}
Original(e) == e + 10
VARIABLES pc, lease, expired, disk, flight, member, sent, resetBy, withdrawn, badPut
vars == <<pc, lease, expired, disk, flight, member, sent, resetBy, withdrawn, badPut>>

Init ==
    /\ pc = [t \in Tabs |-> "idle"]
    /\ lease = "none" /\ expired = FALSE
    /\ disk = {[event |-> e, id |-> Original(e)] : e \in Events}
    /\ flight = [t \in Tabs |-> 0]
    /\ member = [t \in Tabs |-> FALSE]
    /\ withdrawn = {} /\ sent = {} /\ resetBy = "none" /\ badPut = FALSE

Read(t) ==
    /\ pc[t] = "idle" /\ (lease = "none" \/ expired \/ lease = t)
    /\ pc' = [pc EXCEPT ![t] = "write"]
    /\ UNCHANGED <<lease, expired, disk, flight, member, sent, resetBy, withdrawn, badPut>>

Write(t) ==
    /\ pc[t] = "write"
    /\ lease' = t /\ expired' = FALSE
    /\ pc' = [pc EXCEPT ![t] = "verify"]
    /\ UNCHANGED <<disk, flight, member, sent, resetBy, withdrawn, badPut>>

Verify(t) ==
    /\ pc[t] = "verify"
    /\ pc' = [pc EXCEPT ![t] = IF lease = t THEN "select" ELSE "idle"]
    /\ UNCHANGED <<lease, expired, disk, flight, member, sent, resetBy, withdrawn, badPut>>

Expire ==
    /\ lease # "none" /\ ~expired /\ expired' = TRUE
    /\ UNCHANGED <<pc, lease, disk, flight, member, sent, resetBy, withdrawn, badPut>>

Send(t,row) ==
    /\ pc[t] = "select" /\ row \in disk /\ lease = t
    /\ pc' = [pc EXCEPT ![t] = "pending"]
    /\ expired' = FALSE
    /\ flight' = [flight EXCEPT ![t] = row]
    /\ member' = [member EXCEPT ![t] = TRUE]
    /\ sent' = sent \cup {<<row.event, row.id>>}
    /\ UNCHANGED <<lease, disk, resetBy, withdrawn, badPut>>

Reset(t) ==
    /\ resetBy = "none" /\ resetBy' = t
    /\ lease' = "none" /\ expired' = FALSE /\ disk' = {}
    /\ withdrawn' = IF pc[t] = "pending" THEN {t} ELSE {}
    /\ member' = [member EXCEPT ![t] = FALSE]
    /\ UNCHANGED <<pc, flight, sent, badPut>>

Transient(t) ==
    LET put == member[t] \/ SkipGuard IN
    /\ pc[t] = "pending"
    /\ disk' = IF put THEN disk \cup {flight[t]} ELSE disk
    /\ withdrawn' = withdrawn \ {t}
    /\ badPut' = (badPut \/ (put /\ t \in withdrawn))
    /\ pc' = [pc EXCEPT ![t] = "release"]
    /\ flight' = [flight EXCEPT ![t] = 0]
    /\ member' = [member EXCEPT ![t] = FALSE]
    /\ UNCHANGED <<lease, expired, sent, resetBy>>

Release(t) ==
    /\ pc[t] = "release" \/ (pc[t] = "select" /\ (disk = {} \/ lease # t))
    /\ pc' = [pc EXCEPT ![t] = "idle"]
    /\ lease' = IF lease = t THEN "none" ELSE lease
    /\ expired' = IF lease = t THEN FALSE ELSE expired
    /\ UNCHANGED <<disk, flight, member, sent, resetBy, withdrawn, badPut>>

Next == Expire \/ \E t \in Tabs :
    Read(t) \/ Write(t) \/ Verify(t) \/ Reset(t) \/ Transient(t) \/ Release(t)
    \/ \E row \in disk : Send(t,row)

StableKey == \A pair \in sent : pair[2] = Original(pair[1])
LocalWithdrawal == ~badPut
OwnerWithdrawal == resetBy = "none" \/ disk = {}
=============================================================================
