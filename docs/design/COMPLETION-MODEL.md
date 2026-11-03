# Completion model — design rationale

> Rationale for the completion arithmetic owned by `src/lib/guide-stats/` and for
> the path-level aggregation above it. Records the decisions that settle the
> questions left open by the block-count rule of 2026-08-19, implemented in
> `src/lib/guide-stats/block-index.ts`.
>
> Mechanics, not rationale, live elsewhere: `docs/developer/STEP_MODEL.md` for
> the per-step model and its persistence, and the `completion-denominator-authority`
> named invariant in `docs/design/CONCERN_DETAILS.md` for what the denominator
> module is allowed to own.

## Completion evidence

Opening a guide starts observing its active branch, including collapsed sections. For interactive, guided, and multistep blocks, every authored objective must return a satisfied verdict before completion, whether the reader acts independently or uses assistance. Existing outcomes count. With no objectives, ordered action evidence and authored verification determine completion. Section objectives retain their child-completion authority; quizzes, challenges, acknowledgement, and **Mark complete** keep their existing rules.

This extends the completion evidence contract without changing the denominator or storage schema. The `observed` reason identifies manual action detection; `objectives` identifies verified outcomes, and `manual` identifies successful assistance. Tokens that are not condition types, such as legacy prose objectives, are dropped at parse time with an authoring warning and never gate completion; a recognised condition that is unsatisfied or unavailable keeps the block incomplete. A tenant opts out with `enableAutoDetection: false` (the **Automatic completion** setting), and the `pathfinder.passive-completion` flag is the fleet kill switch; either one turns passive observation off and returns sections to their previous rules, where steps and acknowledgement complete them and objectives only complete them early.

## Purpose

This document exists because the completion code will get dense, and dense code
needs rationale: someone fixing a bug in it three months from now should be able
to recover what the behaviour was meant to be without reconstructing it from the
arithmetic.

It is a record of decisions, the reasoning behind them, the bets they rest on,
and what would falsify each bet. It is not a specification and not an RFC — the
schema and the arithmetic are authoritative in code, and where this document and
the code disagree, the code is what shipped and this document is what we meant.

It is also deliberately provisional. Nothing here is settled permanently: we
ship what we have, observe the consequences, and iterate. Each decision below is
a bet made without knowing how it will go, and the falsifiers are the terms on
which observed reality is allowed to overturn it. That is the point of writing
them down — a rationale document is the seed for changing our mind later, not a
defence against it.

So read the [bets](#the-bets-and-what-would-falsify-them) as the operative part.
They are the terms on which this model can be replaced without re-running the
argument.

## The model on one page

| Level     | Progress is                                                    | Reaches 100% by                                                                                                          |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Guide     | completed interactive steps over the guide's total block count | reaching the final completable block, seeing the end of a guide with no completable block, or clicking **Mark complete** |
| Milestone | the same as a guide — a milestone _is_ a guide                 | the same, via **Complete milestone** or the legacy combined control                                                      |
| Path      | the mean of its resolvable milestones' percentages             | every milestone at 100% (decision 9)                                                                                     |
| Journey   | the mean of its children's percentages, if journeys ever exist | every child at 100% (decision 5 — not built, and not needed to be)                                                       |

Since 2026-10-29 a guide is complete at its **final completable block**, not at its final block, and a guide with no completable block is complete when the end of its content is visible. A guide's percentage reads 100 when complete, and otherwise `position / totalBlockCount`, capped at 99. **Mark complete** stays as an optional shortcut. See [issue #2258](https://github.com/grafana/grafana-pathfinder-app/issues/2258) and the dated notes under decisions 1 to 3, 6 and 7.

In the sidebar, floating and full-screen readers, completion and continuation are separate actions. The shared reader records completion immediately and presents a named next milestone or authored follow-up content. It advances only after the reader chooses Continue. The controller overlay keeps the legacy footer because sidebar destinations would open behind its opaque overlay.

The completion panel has no rollout flag: it is a bounded UI change using existing completion evidence and storage, with no migration or irreversible writes. Reverting the UI change does not require a data rollback. The package-browser flag still controls catalog suggestions and Explore links.

The panel uses established completed state, not scroll position. Path completion follows the existing best-of-sequences calculation in decision 4, including selected tracks and exclusion of locked entries. Reaching the last milestone alone does not establish completion. Related suggestions do not create enrollment or progress, and author previews retain the existing footer.

After path navigation, authored `suggests` can offer related content. Their order is preserved, alternative groups offer one eligible member, and completed groups are skipped. `depends` and `recommends` remain hard and soft prerequisite metadata, respectively; neither is used or resolved as next-content selection. A milestone's manifest and its owning path's manifest remain distinct; terminal path recommendations can use both without treating the parent's metadata as the milestone's own.

Completion cards share a layout with full descriptions and bottom-aligned launch actions. The panel has one Explore and My learning navigation row. Completion actions use Start, Resume, or Continue, with destination-specific accessible names. My learning opens the learning page, not the recommendations tab. Authored suggestions can offer two distinct destinations. A standalone bundled guide can offer one unfinished member after it in an existing curated path, never an earlier member. Topic, title overlap, effort, and onboarding category alone do not establish a useful next step, so the panel does not use them to fill suggestion slots. With no eligible suggestion, My learning is the primary action. Returning to completed content does not replay the completion animation or move focus.

Missing catalog references resolve through bounded metadata-only requests. Official references stay in official repositories, and organization references stay in the current organization. Private content without explicit authored suggestions makes My learning the primary action rather than inferring suggestions. Legacy private percentages cannot establish organization provenance, so private suggestion cards do not infer completion from them.

**A vocabulary warning before you read further.** "Journey" in decision 5 means a
level _above_ paths — a path of paths. That is not what "journey" means in the
code today: `milestoneCompletionStorage` — now a read-only legacy store, kept
only for backfill and reset — is keyed by `journeyBaseUrl`,
`getLearningJourneyBaseUrl` canonicalizes it, and `rollUpGuideStats` treats "a
path or journey" as one thing with milestones under it. In current code a
learning journey sits at the same level as a path, not above it. If decision 5 is
ever built, that collision has to be resolved first; until then, read "journey"
below as the hypothetical outer level and "learning journey" in code as a path.

Two properties follow that are worth stating before the decisions, because most
of the design pressure comes from them:

- **Prose is unmeasurable.** A paragraph emits no signal. A guide with more prose
  than interactive steps therefore has a coarse percentage, and a guide with no
  interactive steps at all has only two values. (Since 2026-10-29, seeing the end
  of such a guide is its evidence; see decision 3.)
- **Nothing above a guide needs a total.** Because a path consumes its
  milestones' _percentages_ and not their block counts, no path-wide step total
  or block total is ever computed, stamped, or reconciled.

### Worked example — path progress

A four-milestone path where the reader has finished the first milestone and is a
quarter of the way through the second:

```text
(100 + 25 + 0 + 0) / (100 × 4) = 31%
```

Equal weight per milestone, by construction. A 27-block milestone and a 7-block
milestone each contribute up to 25 points.

### Choice-driven guides

Guides with checkbox groups or section visibility controls use a selected-path exception to the legacy position rule. The authored index stays frozen. A projection excludes hidden content from the runtime denominator.

Within each section, completion evidence credits preceding blocks in that section. It does not credit an independent, unfinished section. Section acknowledgements credit that section's content. Saved choices credit their input block, but an unanswered required group prevents completion.

The universal completion button remains visible. It is disabled for unanswered required groups. Since 2026-10-29 a choice guide applies the final-completable-block rule to its active path: it is complete when no required choice is unanswered and the final completable block on the active path is completed. With no completable block on the active path, every active position must be completed. A choice guide with no completable block anywhere can also complete by being viewed, once its required choices are answered. A guide mark records the active path, so a later selection cannot complete new content automatically. Completed-step evidence and marked-block snapshots survive deselection and reselection.

Guides without these features retain the legacy model. Conditional blocks retain their one-block counting rule. Analytics distinguish the selected-path rule with `choice-path-v2` (`choice-path-v1` before 2026-10-29) and report `active_block_count` alongside authored counts.

## What the library actually looks like

These numbers describe the library as measured on 2026-08-28, under the old rule
where only a click could finish a guide with no completable block. They are
still the authoring statistics, and still the reason the button exists. Since
2026-10-29 the 308 no longer need the button to reach 100%: they complete when
read to the end (decision 3). The "no evidence source possible" wording below is
the pre-2026-10-29 reading.

Two investigations measured the published library before these decisions were
taken. Their numbers are the strongest justification for
[decision 2](#decision-2--every-guide-and-every-milestone-ends-in-a-mark-complete-button)
and the strongest support for the
[rejected alternative](#the-alternative-considered-and-rejected),
and they should be read in both directions.

Across 598 published `type: "guide"` packages, counted with the canonical
`computeGuideBlockIndex`:

| Population                                                | Count | Share |
| --------------------------------------------------------- | ----: | ----: |
| No completable block at all — no evidence source possible |   308 | 51.5% |
| A completable block exists, with content after it         |   281 | 47.0% |
| Already ends on a completable block — reaches 100% today  |     9 |  1.5% |

- **51.5% of the library can register no progress of any kind today**, and 256 of
  those 308 have no section either, so they have neither a "Do it" nor a section
  to acknowledge. They can record 0% and nothing else, forever.
- **Fewer than 2% of the library is authored such that a reader can reach 100% by
  doing things.** Not one journey milestone in the entire library ends on a
  completable block.
- Of the 281 guides with content after their last completable block, only **45%
  of those tails are wrap-up prose**. **32% carry instruction the reader must
  still perform**; the remaining 23% are ambiguous and lean substantive on
  hand-read.
- The worst case is `kafka-monitoring-explore-kafka-metrics`: its last completable
  block sits at position 3 of 14, and its 11-block tail is the nine-panel
  dashboard tour the guide exists to teach.

The 308 are why the completion button cannot be conditional. The 281 are why
awarding 100% at the last completable block would have been wrong. And the 51.5%
is why the worry about an understated KPI is not hypothetical.

> **Reopened 2026-10-29.** Awarding 100% at the last completable block is now the
> rule, because the click-only alternative failed (bet 1). The 32% of tails that
> carry instruction the reader must still perform are the cost; authors handle
> them by putting that instruction before the last interactive block or in a
> block of its own (see `docs/developer/CUSTOM_GUIDES.md`, "Where a guide completes").
> Completion is a bookmark, not a competence claim.

## Decision records

### Decision 1 — guide progress is completed interactive steps over total block count

**Decision.** The denominator is the guide's total block count, per the counting
rule of 2026-08-19 (containers transparent; `multistep`, `guided`, `conditional`
and `snippet-ref` counting as one block each with their children excluded). The
numerator is what the reader has demonstrably completed.

**Why.** Blocks are the only unit that exists for every guide, is knowable
without rendering, and is stamped into the manifest at publish. Counting steps
over steps would make a percentage that says nothing about how much of the guide
the reader has actually seen; counting characters or scroll depth would invent
evidence we do not have.

**What we gave up, knowingly.** Prose cannot be measured, so a guide with more
prose than interactive steps loses precision — its percentage moves in large
jumps and can sit still through several screens of content. This was accepted
with open eyes, not overlooked. The alternative was to make prose measurable,
which means either instrumenting it (an authoring change, see
[bet 4](#bet-4--authors-will-instrument-their-content-once-the-percentage-makes-the-gap-visible))
or inferring engagement from scroll and dwell, which we rejected as softer than
evidence.

**Reopened 2026-10-29: the guide completes at its final completable block.**
Visibility is now an evidence source for guides with no completable block (and
for docs pages and HTML milestones, which publish no block index at all), so the
sentence above that rejects inferring engagement from scroll is amended, not
withdrawn: the rejection stands for partial progress. The denominator and the
numerator are unchanged. What changed is when the numerator counts as done: a
guide with `completableBlockCount > 0` is complete when the furthest evidenced
position is at or beyond `finalCompletablePosition`, and its percentage reads
100 then, instead of stopping at 99 until a click. Trailing prose after the last
completable block no longer holds the guide below 100. The old rule is
`block-position-v1`; the new one is `block-position-v2`.

A reader who finished the last completable block under the old rule sat at 99%
and recorded nothing. Reopening the guide recomputes the percentage
(`refreshGuidePercentageOnLoad`), and the load backfill records the completion
after the 200 ms settle window, without `duration_ms`. It does so only on the
first crossing: the persisted percentage read before the recompute was below
100 and the recomputed one is 100. A choice guide computes no percentage until
its saved responses arrive, so its crossing is judged at the first refresh that
can compute one, against the same pre-load baseline. The persisted percentage
lives in the same per-browser record as the evidence that produces it: neither
the interactive completion record nor step evidence syncs down from Grafana
storage. A guide that already read 100 in this browser, because it completed
or was click-marked, records nothing at load.

**Which tree the denominator is counted from.** A `snippet-ref` is one block
however many it resolves to, so the count is the PRE-inlining one. Two opening
paths do not present the same tree: a direct open renders the pre-inlining tree
and expands snippets afterwards, while `prepare-guide-launch.ts` expands before
a surface is committed and hands the renderer the expanded tree. Counting
whichever tree arrived gave the same guide a different denominator per path, and
freezing the index preserved whichever one the reader's first path produced.
The prepared payload therefore carries the pre-inlining tree it was expanded
from (`lib/guide-counting-source.ts`), and the content-load seam counts that
tree on both paths — the whole index from that one traversal, not a corrected
denominator beside post-expansion positions. An expanded payload that lost that
tree still renders; it publishes no index at all, because a count taken from the
expanded tree is not the canonical one and the freeze would keep it.

**Implementation note for the debugger.** The numerator in `guide-stats/progress.ts`
is the _furthest evidenced position_, not a count of completed steps. The two
coincide because positions are monotonic and reaching position `n` implies
`1..n-1` — that is the point of a position-based numerator, and it is why
preamble that emits no evidence is never individually completable. If you are
chasing a percentage that looks too high, look at `containerEndPositions` and at
which block a section acknowledgement credited, not at a completed-step count.

**Transitional behaviour: a percentage persisted under the previous counting
rule.** Before this decision, a guide's persisted percentage was
`completedSteps / totalDocumentSteps`; this decision makes it `position /
totalBlockCount`, which is systematically lower for the same real evidence —
a guide that read 100% under the old rule can read well under 100% under this
one for identical completed steps. The stored record carries no version, so
nothing can tell an old-rule value from a new-rule one by inspection. Rather
than migrate or version the namespace, the content-load seam
(`content-renderer.tsx`) recomputes and re-persists a guide's percentage
under the current rule whenever its frozen index publishes and real evidence
already exists (`refreshGuidePercentageOnLoad`) — so reopening a guide is
what heals it. A guide with real evidence that is never reopened keeps
reporting its old-rule value until it is. This is deliberately not a proof:
a guide read only through a surface that never re-triggers the content-load
seam stays stale for as long as that holds, and the direction of the error
is always the same (a stale value reads too high, never too low), which is
what makes a path or journey able to read complete off a member that has not
actually recomputed.

### Decision 2 — every guide and every milestone ends in a Mark complete button

> **Reopened 2026-10-29 (issue #2258).** The button stays, unconditional, on every
> guide and milestone. It is no longer the only path to 100%: a guide now
> completes at its last completable block, or when its end is visible if it has
> none. The button is an optional shortcut. Removing it is follow-up
> [#2259](https://github.com/grafana/grafana-pathfinder-app/issues/2259), which
> must first handle a final completable block after an id-less `snippet-ref`
> sibling (the index cannot key it, so the button is its only route to 100%).
> The reasoning below is the original argument for the button.

**Decision.** Every guide and every milestone ends in a button that takes the
reader to 100%. No predicate. No special cases. Labels differ by context only:

| Context   | Label                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Guide     | **Mark complete**                                                                                          |
| Milestone | **Complete milestone** with the completion panel; **Mark complete and continue** in the controller overlay |

(Written in sentence case per the Grafana Writers' Toolkit, as AGENTS.md requires;
the decision is that the label differs by context, not how it is capitalised.)

**Why.** Principle of least surprise. A button that appears on some guides and
not others leaves a reader who does not see it unable to tell whether they were
given completion recognition at all — and unable to tell that from a bug.

A conditional button is a button whose absence the reader cannot interpret. On a
guide that already ends on a completable block, the button is redundant; on a
guide that does not, its absence is indistinguishable from a bug. The redundant
case costs a click that does nothing new. The missing case costs the reader their
completion, and costs us the ability to tell "did not finish" from "finished, had
no way to say so."

**What this removes.** `GuideBlockIndex.finalCompletablePosition` was introduced
as exactly this predicate: `finalCompletablePosition === totalBlockCount` meant
"needs no Mark complete button at its foot." That reading is gone — the button is
unconditional. The field itself stays, and stays useful, as an **authoring
signal**: it is the discriminator that told us the tail measurements above, and
`finalCompletablePosition / blockCount` predicts tail content cleanly (above 0.90
there is not one substantive tail in the library; below 0.50, 35 of 43 are
substantive). Do not re-derive a rendering predicate from it without re-opening
this decision.

**Where the code stands.** `components/mark-complete/` renders the control for
every guide and every milestone from inside `ContentRenderer`, so all four
reading surfaces and the block-editor preview carry it from one site. The mark
persists per content key in `guideCompletionMarkStorage`, beside the per-section
`#842` acknowledgement rather than in place of it, and every reset path clears
it so a guide the reader resets comes back unmarked and clickable. Reaching 100%
is what triggers badge awards, durable completion records, path progress and the
"continue learning" CTA, so before this control existed no guide in the library
could trigger any of them under this model.

What the mark is wired to, precisely: the completion store treats it as
authoritative for the guide percentage — `peekGuidePercentage` and
`refreshGuidePercentage` both report 100 for a marked guide regardless of the
evidence, so a later step write cannot move it back down and every reader
of the percentage agrees. What it is **not** yet wired to is the evidence
arithmetic in `progress.ts`: that module models the `mark-guide-complete`
evidence kind — the one that evidences the whole guide regardless of `blockId` —
but nothing converts the stored mark into a `CompletionSignal`, and
`guideProgress` / `furthestEvidencedPosition` still have no production caller.
Connecting the two is the later derivation work item, not this one.

A path's cover page is the one place the control is absent, and that is not the
predicate this decision deleted: a table of contents is neither a guide nor a
milestone, and marking one complete would record a guide nobody read.

**Evidence.** A narrow predicate was measured against the library and fires for
the wrong population: an earlier candidate — "prose-only, or no sections" — fires
for zero of the ten bundled guides, and the 308-guide finding shows the narrow
case is in fact the majority of the library rather than an edge. There is no
predicate that is both simple and right, which is a strong argument for having
none.

### Decision 3 — an all-prose guide is 0% or 100%, with nothing in between

**Decision.** Accepted as a direct consequence of decisions 1 and 2. A guide with
no completable block has one evidence source, the Mark complete button, so its
only reachable values are 0% and 100%.

> **Amended 2026-10-29.** Still 0% or 100%, and still intended. What changed is
> the evidence: a guide with `completableBlockCount === 0` (or a docs page or
> HTML milestone, which publishes no index) reaches 100% when the end of its
> content is within 50px of the bottom of the visible area, as well as by
> clicking the button. A guide that fits on screen completes when it opens. The
> trigger is `GuideEndSentinel`, armed only after content is ready, images have
> settled and the tab is visible, and it latches once per mount. It records as
> source `objectives`, with no new completion source (see decision 7 and
> "Rolling this back"). A docs page still produces no durable completion record
> or `pathfinder_guide_completed` event, as before.

**Why record a consequence as a decision.** Because it was stated explicitly and
accepted, rather than discovered later. It is the sharpest edge of decision 1's
trade-off and it applies to 51.5% of the published library. A future reader
finding a wall of 0%-or-100% guides in the warehouse is looking at intended
behaviour, not a bug — and the honest reading of that wall is an authoring
problem, not an arithmetic one.

### Decision 4 — path progress is the best of its sequences' mean member percentages

**Decision.** A path's percentage is the arithmetic mean of a sequence's
members' percentages, members weighted equally regardless of length (see the
[worked example](#worked-example--path-progress)), computed once per
sequence a path declares — the Foundations `milestones` list, plus each Path
Tracks entry's own `guides` list as its own separate sequence (decision 10) —
and the path's displayed percentage and completion are the BEST (highest)
result across every sequence. A path with no `tracks` has exactly one
sequence, so this is unchanged from the pre-tracks formula. A track hitting
100% completes the path even if Foundations or another track has not,
because the reader's real progress is whichever sequence they are actually
furthest through, never a blend across sequences they may not be taking.

**Why.** The per-sequence mean is the only aggregation that needs nothing a
path does not already have. Milestones are fetched one at a time; a path's
step or block denominator is not knowable when the path opens without either
declaring it in the manifest or fetching every milestone up front. Averaging
percentages sidesteps the question: each milestone knows its own denominator,
and only the percentage bubbles up. Taking the best across sequences rather
than blending them follows from decision 10: a track is a different way
through the same path, not a second path with its own denominator to
reconcile against Foundations'.

**The consequence worth recording.** **No path-wide step total or block total
ever needs pre-calculating.** That is not a minor simplification — it deletes a
whole class of work: no declared step counts to keep honest, no publish-time
recount, no CI parity check, no drift between a stamped total and the content it
counted, and no monotonicity problem when a total changes under a reader mid-path.

**What this means for `rollUpGuideStats`.** `src/lib/guide-stats/summary.ts` sums
a path's milestones into one `GuideStatsSummary`, and no rollup index ever lands
beside it: path progress consumes per-guide percentages, not a summed
`blockCount`. The rollup remains valid and useful as a **reporting and
authoring** figure — how big is this path, how much of it is instrumented — but
it is not a completion denominator. The `denominator-position-pairing`
invariant and `rollUpGuideStats`'s own docstring both say so, and the formula
itself is `meanOfMemberPercentages` in `src/lib/guide-stats/rollup.ts`.

**What we gave up.** Equal weighting means a milestone's contribution is
unrelated to its size, so a path of one short milestone and one long one reports
50% at what is really a fifth of the reading. We think that is acceptable and
say why in [bet 3](#bet-3--equal-weighted-milestones-are-fair-enough). The
rejected alternative held that this is the single thing most likely to make the
number unusable; its case is recorded in full
[below](#the-alternative-considered-and-rejected).

### Decision 5 — journeys, if ever needed, are paths of paths and the formula recurses

**Decision.** If journeys are ever needed as a level above paths, a journey is a
path of paths and decision 4's formula applies unchanged: a journey's percentage
is the mean of its paths' percentages, and so on for any level above that.

**Why record something not built.** Because the property that makes it free is a
property of decision 4, and a future change to decision 4 should know it is
paying for this too. Any aggregation that reaches past its immediate children —
weighting by block count, say — loses the recursion and needs a new rule at every
new level.

### Decision 6 — back and next navigation earns no completion credit

**Decision.** Moving between milestones with back and next is navigation. It
credits nothing. A reader can browse a whole path without completing anything:
no interactive action performed and nothing marked complete is no completion
progress.

**Why.** Navigation is not evidence. A reader who clicks through eight milestones
in twenty seconds has demonstrated nothing about the eight milestones, and a
model that credited them would report a path as complete on the strength of a
reader looking for its last page.

> **Clarified 2026-10-29.** Navigation still earns nothing. Clicking **Next**
> completes a prose-only milestone only because its end was visible on arrival,
> and nothing else. A milestone with a completable block still needs evidence at
> that block. Very fast completions are an analytics signal, not a gate.

**What this changes.** Learning-path completion used to be
milestone-click-based: the path rollup in
`src/learning-paths/learning-paths.hook.ts` counted milestones present in a
completed-guides list, and `milestoneCompletionStorage` recorded milestone
slugs. It is now `calculatePathRollup`, the mean of its members' own
percentages, so a milestone reaches 100% the same way a guide does and
navigation past it does not. This is exactly the baseline the
rejected alternative argues against discarding, so the change is deliberate and
its cost is known: the
existing milestone-click series is not comparable to what comes after it, and any
before/after read across the cutover needs to say which model produced each side.
`markMilestoneDone` now writes a milestone's completion into
`interactiveCompletionStorage`, under the same sanitized-URL content key
`calculatePathRollup` and `journeyMilestonePercentages` read back;
`milestoneCompletionStorage` is a read-only legacy store today, consulted only
for a one-time backfill into `interactiveCompletionStorage` and still cleared,
never written, by the reset flows.

### Decision 7 — a separate `markCompleteClicked` event ships alongside the completion event

> **Note 2026-10-29.** `markCompleteClicked` stays click-only. A bottom-visible
> completion never emits it, which is what keeps "completion without clicks"
> readable: completions with no click are now expected, and the gap between the
> two events measures how many readers finish without the button. A viewed
> completion is reported as an `objectives` completion with
> `completable_block_count` 0 and `block_progress_rule_version` `block-position-v2`.

**Decision.** Clicking the button emits its own analytics event, distinct from the
completion event it causes. It joins the `UserInteraction` enum in
`src/lib/analytics.ts` and follows that enum's snake_case wire convention.

**Why, two reasons.** It makes querying easier — a completion attributable to the
button should not have to be reconstructed by joining against the absence of step
evidence. And it detects a specific failure mode:
**completion sitting high with no clicks means readers are ignoring the button**,
and without a separate event that pattern is invisible. It is the instrument for
[bet 1](#bet-1--readers-will-click-the-button-often-enough-for-completion-to-mean-something)
and [bet 2](#bet-2--the-nudge-teaches-the-behaviour); those bets cannot be settled
without it.

### Decision 8 — a teaching nudge on any incomplete milestone, which must not block

**Decision.** When the reader clicks "next milestone" without having marked the
current milestone complete, show a small tip or modal teaching them to mark it
complete first. It fires whenever a reader leaves an incomplete milestone,
prose-only or not.

**It must not block them from moving on.** This is the load-bearing half. The
nudge exists because decision 6 means navigation earns nothing and decision 3
means a prose milestone has exactly one way to earn something; a reader who does
not know that loses their progress silently. A nudge that gated navigation would
turn a teaching moment into a toll, on the population least likely to tolerate one.

**Why not restrict it to prose-only milestones.** A narrow nudge would reintroduce
the same "sometimes you see it" inconsistency that decision 2 removed from the
button, and the reader cannot tell a nudge that did not fire from one that was
suppressed. The counter-argument — that a nudge is advice and a button an
affordance, so inconsistent advice costs less than an inconsistent control —
was heard and not taken: firing on every incomplete milestone needs no predicate
and is the same shape as decision 2. A prose-only milestone remains the
population where the tip does most of its teaching, which is where bet 2 measures
it, but that is an evidence population and not a firing condition.

> **Note 2026-10-29.** No conflict, but the premise shrank. The nudge's reason was
> that a prose milestone has exactly one way to earn something; it now has two,
> and a reader who clicks **Next** from a prose-only milestone whose end was
> visible has already completed it, so the nudge does not fire there. It still
> fires on any milestone that is incomplete when the reader leaves, and still
> must not block navigation.

**Its frequency and per-reader state are open.** See
[open questions](#open-questions).

### Decision 9 — an unresolvable path member is excluded from the mean and counted

**What is built.** `src/global-state/path-member-join.ts` and the rollups that
consume it both ship: `calculatePathRollup`
(`src/learning-paths/learning-paths.hook.ts`) and
`journeyMilestonePercentages` / `journeyProgressFromMilestones`
(`src/docs-retrieval/learning-journey-helpers.ts`) resolve each member's own
percentage through this join and average them with `meanOfMemberPercentages`.
Every UI consumer reads that number, so the rules below are live rather than
staged.

**Decision.** Decision 4's mean joins each member to its persisted percentage by
content key, and that key is stored nowhere: a member is keyed by the sanitized
URL it was launched from, while a path definition carries ids. Where a member's
launch URL has not resolved, every scheme it could have been launched under is
read. That set is `bundled:<id>`, `bundled:<id>/content.json`, and
`backend-guide:<id>`: a bundled guide has two live launch shapes, because My
Learning opens it bare while the package resolver hands the context panel the
package form. A resolved `bundled:` URL is therefore read alongside its sibling
shape in both directions. Where the member cannot be answered for at all, it is
**excluded from the mean and counted**, never scored zero.
`src/global-state/path-member-join.ts` owns this: one internal grouped
id-scheme list is the source of truth, the join's read path maps the content-key
sanitizer over it, and `resetPath` reads its flattened raw form rather than
restating the schemes.

**The furthest record wins within a scheme; precedence decides across them.**
An earlier draft of this decision claimed a reader can only have progressed
under one key. That is false within `bundled:`: the bare and package launch
shapes are independently reachable for the same guide and
`interactiveStepStorage` keys step progress by content key, so each shape
accrues its own, and taking the first key that holds anything would
under-report a reader who opened the guide from both surfaces. Within a scheme
the join therefore takes the maximum, which is the honest answer to how far
the reader got.

It is also false the other way round — an earlier draft claimed a guide is
bundled or App Platform and not both. `createCompositeResolver` says the
opposite: id collisions are possible, nothing enforces the `fe-`-prefix
convention that makes them unlikely, and bundled/CDN deliberately win one so
today's fallback behaviour is preserved
(`src/package-engine/composite-resolver.ts`). Two schemes carrying the same id
may therefore be two different guides, so a maximum across schemes would report
a private guide's progress as a bundled member's. The join consults the schemes
in the resolver's own precedence order and the first one holding a record
answers — including when that record is unreadable, because falling through
would substitute a different guide's number for a corrupt one.

**That precedence covers the id-scheme branch only; a supplied member URL is
trusted verbatim.** `path-member-join.ts` is pure — it cannot consult the
bundled repository, so when a caller hands it a member with a `url` it has no
basis to second-guess which guide that URL names, and it reads that key alone
(plus the sibling launch shape, when the URL is `bundled:`). One case therefore
stays open rather than being closed here: `resolveGuideMetadata` consults App
Platform metadata before the static fallback, and that metadata covers every
published guide rather than only members of App Platform paths, so a colliding
CR id can hand the join `backend-guide:<id>` for a member of a static bundled
path. **Known follow-on for the rollup:** the caller resolving member URLs
bundled-first, matching the composite resolver, so the join is never handed an
App Platform URL for a bundled member. Until then, do not read decision 9 as a
guarantee that a private guide's progress can never surface as a bundled
member's — only that the join's own scheme fallback will not cause it.

**A present but unreadable record is excluded too, not scored zero.** The
persisted record is unchecked `JSON.parse` output, so a key may be present and
hold something other than a percentage. `BoundedRecordStorage.set` clamps to
`[0, 100]` on write, so anything outside that range — or not a finite number at
all — is corruption. That member _was_ opened, so zero is not the honest answer
any more than it is for a member with no formable key: it is excluded and
counted under its own `'unreadable'` source. Under furthest-wins this also
matters more than it reads — an unclamped 500 would otherwise win every
candidate set it appears in and inflate the path's number.

**An absent key means never-opened only as far as the record does.** The join
treats a formable-but-absent key as never-opened and scores it zero, which is
the honest answer for a reader who has not started that guide. It is _not_
honest for a reader whose record was evicted: `interactiveCompletionStorage`
caps at `MAX_INTERACTIVE_COMPLETIONS` (250, `src/lib/user-storage.ts`), and past
that cap `writeWithCap` drops zero-progress entries first and then the least
recently written of the rest. Reading two candidate shapes per bundled member
raises the pressure, because a guide opened from both surfaces occupies two
slots.

The information needed to tell eviction from never-opened is gone by the time
the join runs, so this is not fixable in `path-member-join.ts`. Eviction now
falls on the entries a reader has stopped touching rather than the ones they
opened first, which is what closes the case where a heavy reader lost progress
on a guide they were actively using.

**Recency and furthest-wins disagree on a split pair.** Storage sees two launch
shapes of one guide as two unrelated keys, so it cannot prefer the pair's higher
record — it keeps whichever was written more recently. The join prefers the
higher. A reader who reaches 80% under `bundled:<id>/content.json` and later
does one step under bare `bundled:<id>` has a fresh 10% and a stale 80%; the
join reports 80% until the 80% entry ages out, and 10% after. The zero-first
pass covers the common case, where the twin holds no progress at all and is
dropped losslessly. Closing the rest needs the pair to be known where the keys
are paired, which is here and not in storage.

**The key spaces `resetPath` clears are not one space.**
`interactiveCompletionStorage` and `interactiveStepStorage` are keyed by the
sanitized content key; `milestoneCompletionStorage` (legacy-only, kept for
backfill and reset) and `journeyCompletionStorage` are keyed by the raw launch
URL. `resetPath` builds
both from the join — `pathMemberContentKeys` for the sanitized namespaces,
`pathMemberIdSchemeKeys` for the raw ones.

**A candidate key must survive normalization unchanged, and this is a safety
rule, not a tidiness one.** `sanitizeContentKey` strips `..` and truncates at
200 characters, so it is not injective: `welcome..-to-grafana` normalizes onto
the real `welcome-to-grafana`, and two ids agreeing on their first 192
characters normalize onto one key — reachable without malformed input at all,
because a package id may be 253 characters. `resetPath` **deletes** the keys
the join builds, so a rewritten candidate would destroy a different guide's
progress irreversibly. The join therefore refuses any candidate the sanitizer
would rewrite, and such a member resolves as `unresolved` — excluded and
counted rather than joined to someone else's record. The refusal covers the
whole member, not just the failing candidate: a `bundled:` id of about 180
characters keeps its bare shape but loses `bundled:<id>/content.json`, and if
its record sits under the lost shape, searching only the survivors would score
it as an unopened zero.

The consequence is deliberate and worth stating: for such a member the raw-keyed
namespaces are still cleared, because a raw key names only its own member, while
the sanitized ones are **spared**. That is the correct trade — sparing a record
is recoverable, deleting the wrong one is not — and it does not leak a stale
percentage, because the join refuses the same key it declined to clear. Validating
ids at the wire boundary, so an id that cannot be keyed safely never reaches a
path definition, is **known follow-on work** outside this module.

**Why not zero.** A zero is indistinguishable from a real result. It drags the
path's number down silently and in exactly the direction the
[rejected alternative](#the-alternative-considered-and-rejected) predicts, so a
join bug would arrive looking like confirmation of it. Excluding the member
keeps the mean honest over what it can actually see, and the count is what makes
the gap visible instead of silent.

**Read the percentage from `interactiveCompletionStorage`, and only that.**
`journeyCompletionStorage` is the namespace a journey's own output is persisted
to and is the obvious thing to reach for, but it holds no record under
`backend-guide:` for a partially progressed member. Joining against it would
exclude every partially progressed App Platform path member — a systematic
exclusion, not an edge case.

**A presence check, not a value read.** The storage `get` returns 0 for a
missing key, which collapses the distinction the decision rests on. The join
reads the whole record and tests for the key.

### Decision 10 — a Path Tracks track is a presentation ordering, scored the same way Foundations is

**Decision.** A `tracks` entry (Path Tracks RFC) is a named,
independently-ordered **presentation** view over some subset, superset, or
reordering of a path's guides. It is not a second path with its own
persisted percentage, badge, or "N of M" count (see "What we are not doing
here" below) — but decision 4's best-of-sequence formula scores it on equal
footing with the Foundations `milestones` sequence: My Learning's path-wide
percentage and completion for a path are the best result across Foundations
and every track, never Foundations alone and never a blend of all of them.

**Why.** A track's `guides` list can name a strict subset of `milestones`, a
strict superset, or a partial overlap with role-specific guides
interleaved anywhere (`package.types.ts`'s `ManifestTrack` doc comment) — it
is not a reordering of the same member set, which is exactly why blending
Foundations and every track into one flattened mean (the pre-decision-4-update
behavior) was wrong: a learner nearly finished with a 10-guide Seller track
would see that work diluted by two untouched tracks and an unstarted
Foundations sequence, and "complete" would require finishing every guide in
every track rather than any one real way through the path. Scoring each
sequence separately and taking the best fixes that without inventing a
second completion authority: a learner who finishes a 3-guide Seller track
containing 1 guide `milestones` never had really is done with the path by
any sequence that matters to them, and the path should say so.

**What this means for the cover page's per-tab progress ring.**
`LearningPathTableOfContents.tsx` computes `journeyProgressFromMilestones`
against whichever sequence's own tab is active — Foundations' `milestones` or
a track's own `guides` — exactly as decision 4's per-sequence mean already
does. That number and My Learning's path-wide percentage can still diverge:
the ring shows progress through the active tab specifically, while My
Learning shows the best sequence regardless of which tab is active (finishing
a track while looking at Foundations' tab still completes the path). They
converge exactly when the active tab happens to be the best-scoring sequence.
The ring's accessible label names the active sequence
(`{{percent}}% through {{sequence}}`) so it never reads as a path-wide claim.

`app-platform-paths.ts` builds `LearningPath.guides` from
`getManifestMemberIds` (milestones plus every track-only guide, published
members only) so `resetPath` can clear track-only completions; `learning-paths.hook.ts`'s
`calculatePathRollup` splits that same set back into its Foundations and
per-track sequences (intersected against `path.guides`, so an unpublished
member still drops out) before scoring each one and taking the best.

**What we are not doing here.** A track earning its own DURABLE, independently
persisted percentage, badge, or "N of M" count outside of this best-of-sequence
comparison — e.g. a badge for finishing the Seller track specifically — is a
`completion-denominator-authority` change and belongs in its own PR against
`src/lib/guide-stats` and `path-member-join.ts`. This decision only says which
of a path's existing sequences its one path-wide percentage/completion follows.

## The alternative considered and rejected

One position argued against the path-level half of this model. It was overridden,
deliberately, with an agreement to iterate — not answered. It is recorded here in
full because **it is the most likely reason this design changes later**, and
because the falsifier for
[bet 3](#bet-3--equal-weighted-milestones-are-fair-enough) is this position's
prediction restated as a measurement.

**Its scope is narrow, and deliberately so.** It does not dispute completion
tracking in interactive guides; on that content the model is accepted as working
well. The objection is specifically about learning paths whose milestones are
text-only.

**Its prediction.** Readers are far more likely to click "next" after reading
than to click a completion button at the bottom of a page. PLG readers do not
care about their own completion — it is our metric, not their goal. The result
will be interactive guides showing much higher completion than learning paths,
and docs authors reasonably calling that unfair tracking of their content.

**Its status-quo argument.** Today's learning-path completion is based on
milestone clicks, so a baseline series already exists. Better to build on that
series than discard it. (Decision 6 discards it — see that decision's "what this
changes".)

**Its own assessment of its strength.** The case was offered as intuition rather
than evidence, and as a devil's-advocate position rather than a blocking
objection. The specific worry it names is concrete, though, and survives that
caveat: that we are choosing a tracking method which by default produces an
understated KPI for half the library, and then reading the understatement as a
fact about readers rather than about the instrument.

**Why it did not win.** The measurements above cut both ways. The 51.5% finding
is the reason the completion button cannot be conditional (decision 2), and it is
also the reason this position expects the resulting number to be depressed. What
tipped it was that the alternative — keeping milestone-click completion for paths
— makes path % and guide % permanently different units, which is the problem the
model exists to solve; and that the depression it predicts is measurable rather
than speculative, so it can be detected and acted on instead of argued about in
advance.

If bet 3's falsifier fires, this position was right, and the argument does not
need re-running: the evidence is the decision.

## The bets, and what would falsify them

Each bet is a prediction we are making without knowing. Each has a falsifier that
is a measurement, not an opinion. If a falsifier fires, the decision it supports
is back on the table.

### Bet 1 — readers will click the button often enough for completion to mean something

> **FALSIFIED 2026-10-29** ([#2258](https://github.com/grafana/grafana-pathfinder-app/issues/2258)).
> Only 34% of ObsCon workshop attendees clicked every Mark complete button, and
> workshop attendees used the milestone arrows without recording completion.
> In product analytics, counting scroll-to-bottom alone moves auto-opened guides
> from 2.2% to 10.0% completion and clicked-into guides from 27% to 48%. The gap
> is readers who finished and never did the paperwork. Decision 2 is reopened as
> a result (see its note). The rest of this section is the original bet.

**We are betting** that an unconditional, always-visible completion button gets
used, so that a reported completion percentage reflects readers finishing rather
than readers happening to end on a completable block.

**Falsified by:** high step-completion percentages with few or no
`markCompleteClicked` events. Concretely: guides whose readers reach the final
counted block's neighbourhood but whose `markCompleteClicked` rate stays near
zero, and prose-only guides (the 308 population) that stay at 0% in aggregate
despite being read.

**Evidence source:** the `markCompleteClicked` event from decision 7 against the
completion event, in RudderStack — see `docs/developer/TELEMETRY.md` for the
policy and privacy constraints on what may be joined. The durable completion
records written through the App Platform proxy are the second read, and the one
that matters for KPIs.

**Known starting point:** 51.5% of the library has no other way to register
anything, so for that population click rate _is_ completion rate. There is no
prior click-rate number, because the button had no producer in the repo before
the control shipped — this bet's baseline is measured from that point on, not
before it.

**If falsified:** the button is not the completion mechanism we thought it was.
The live alternatives are the "check my setup" idea (see open questions), which
replaces self-report with verification, and reintroducing a softer evidence
source for prose, which decision 1 rejected and would have to re-argue.

### Bet 2 — the nudge teaches the behaviour

**We are betting** that a reader who is shown, once, that a prose milestone needs
marking will mark it — that the low click rate we expect at first is ignorance
rather than indifference.

**Falsified by:** no measurable change in `markCompleteClicked` rate on
prose-only milestones after the nudge ships. This is a before/after on a single
metric, which is why it is a clean falsifier — provided decision 7's event is
live for long enough beforehand to establish the baseline.

**Evidence source:** `markCompleteClicked` rate on prose-only milestones, split
either side of the nudge's release. If the nudge ships behind a flag, an
experiment arm is the better read; see `.cursor/skills/create-experiment` and
`docs/developer/FEATURE_FLAGS.md`.

**If falsified:** readers know and do not care, which is the rejected
alternative's PLG argument landing. The nudge should then be removed rather than
tuned — a tip that teaches
nothing is a cost with no return — and the falsifier for bet 1 becomes the live
question.

### Bet 3 — equal-weighted milestones are fair enough

**We are betting** that weighting every milestone equally produces a path
percentage that is close enough to useful, and that the simplicity it buys
(decision 4: no path-wide totals, ever) is worth the imprecision.

**Falsified by:** learning-path completion tracking persistently far below
interactive-guide completion. This is the rejected alternative's specific
prediction. "Persistently" and "far below" need thresholds set before the read,
not after, or the argument re-runs on the interpretation.

**Evidence source:** completion percentage distributions for paths versus
standalone interactive guides, from the durable completion records, segmented by
whether the path's milestones are prose-only. The segmentation is the important
part: a gap that lives entirely in prose-only paths is an authoring problem
(bet 4), while a gap that persists in paths with instrumented milestones is a
weighting problem and falsifies this bet.

**If falsified:** weighting is the thing to change, and the cost of changing it is
exactly the work decision 4 avoided — a path-wide denominator, and with it the
declared-count machinery that
[RFC #14](#relationship-to-grafanapathfinder-rfcs14) analyses. `rollUpGuideStats`
already computes the totals such a change would need.

### Bet 4 — authors will instrument their content once the percentage makes the gap visible

**We are betting** that publishing a percentage makes the 51.5% visible in a way
that prose alone never was, and that authors respond by adding completable blocks
to guides that currently have none.

**Falsified by:** the proportion of guides whose content is measurable staying
flat. The starting values are known and stamped, so this is the most directly
checkable bet of the four.

**Evidence source:** `completableBlockCount` and `finalCompletablePosition` in the
stamped `GuideStatsSummary`, aggregated over the published library — the same
counter, `computeGuideBlockIndex`, that produced the numbers above, run again over
a later snapshot. `src/cli/commands/build-stats.ts` is the stamping path.

**Baseline, 2026-08-28, over 598 published guides** (these count authoring shape.
Since 2026-10-29 the 308 no longer "cannot register progress": they complete when
read to the end, so this bet now measures instrumentation, not whether completion
is possible):

| Measure                                            | Baseline    |
| -------------------------------------------------- | ----------- |
| Guides with no completable block                   | 308 (51.5%) |
| Guides with no completable block and no section    | 256 (42.8%) |
| Guides that already reach 100% by doing things     | 9 (1.5%)    |
| Journey milestones that end on a completable block | 0           |

**If falsified:** the percentage is a scoreboard nobody is playing on, and the
50%-of-the-library problem needs a lever other than visibility — authoring tools,
a publish-time gate, or accepting that half the library reports binary completion
permanently. Note that this bet failing does not by itself invalidate decisions 1
to 4; it invalidates the hope that they would fix themselves.

## Open questions

Recorded as open. None of these is settled.

**The nudge's frequency.** First time in a path, first time ever for
that reader, or every time — and where the per-reader state lives. Every option
has a cost: per-path state multiplies, per-reader-ever state is one more thing a
progress reset must or must not clear, and every-time is a nag.

**Whether look-ahead navigation should be restricted until a milestone is
complete.** Raised and parked. The objection against it is that a reader who
cannot see past the current milestone will conclude the path has ended.

**UX review, which sits with Jess Matz.** Deferred rather than skipped. We may
well be wrong about the button and the nudge, but we are missing the data that
would let us be more right about them now, so the review is better spent once
there is behaviour to look at.

**The "check my setup" idea.** A completion button verifying the reader achieved
the outcome in their own stack, rather than self-reporting it. It is a more
valuable PLG metric than completion, and a separate one — it measures the
outcome, not the reading. Deferred because it needs authors to define the check. Worth noting against
[bet 1](#bet-1--readers-will-click-the-button-often-enough-for-completion-to-mean-something):
if self-report turns out not to work, this is the replacement already on the table.

## Relationship to `grafana/pathfinder-rfcs#14`

Jay Clifford's RFC, "Step-level progression tracking for learning paths", is open
and unmerged at the time of writing. It is the prior art for this model and it
framed the problem correctly: a path's step denominator is unknowable up front,
path progress is milestone-count-based, and path % and guide % are different
units. Its four-option analysis — A manifest-declared step counts with a
triple-check workflow, B runtime parallel fetch-and-count, C mesh milestones into
one rendered guide, D formalize milestone-equal binary completion — is the reason
decision 4 could be made quickly rather than discovered slowly, and its
recommended Option A is a sound answer to the question as it was posed.

**What this model resolves.** Decision 4 removes the need for a path-wide
denominator entirely, so:

- **Option A is no longer required.** There is no path-wide step count to declare,
  so there is nothing for the triple-check workflow (publish-time recount, CI
  parity check, `pathfinder-cli validate`) to verify, and the RFC's headline risk
  — LLM-authored manifests declaring plausible-but-wrong counts — does not arise.
  The per-guide `GuideStatsSummary` stamp remains, and remains machine-generated,
  but it is a per-guide denominator that the guide itself owns rather than a total
  a path depends on.
- **Option B is not needed** as a fallback tier: nothing at path open needs a
  count, so there is no fan-out to bound and no weigh-1 fallback to make
  deterministic.
- **Option C's premise is answered** differently. Comparability between guide %
  and path % comes from both being percentages of the same per-guide rule, not
  from meshing content into one denominator.
- **Option D is adjacent but not what shipped.** D formalizes milestone-equal
  _binary_ completion. This model keeps D's equal weighting and drops its
  binariness: a milestone contributes a fraction, not a bit. That is what makes
  guide % and path % the same unit, which was D's stated cost.

**The RFC's fourth discussion ask stands.** Monotonicity at the flip — clamp,
defer, or accept a one-time backward jump — is a real question for this model too,
because decision 6 changes what a milestone's completion means and the existing
milestone-click series does not convert. It is not answered here.

This document does not close, edit, or comment on that PR. Whether it is closed or
updated is Jay's call.

## Rolling this back

**A journey partially completed under decision 6's migration needs its
in-flight milestones re-marked after a revert.** Milestone completion moved
from `milestoneCompletionStorage`'s click-based record to a percentage in
`interactiveCompletionStorage`; a milestone finished only after the cutover
has no equivalent entry in the old store, so reverting mid-journey would
make that work invisible to the pre-migration model until the reader marks
those milestones again.

The Mark complete control writes two things: the mark itself, in the per-guide
`guide-complete-mark-*` namespace this model introduced, and a 100 in
`interactiveCompletionStorage`, the percentage namespace that predates it and
that `context.service.ts` reads for recommendation cards and context.

**The 100 is deliberate and survives a rollback.** It is the reader's own
statement that they finished the guide, recorded in the namespace every other
reader of "how far through is this guide" already consults. Removing the control
does not make that statement untrue, so the value is kept rather than treated as
residue. The consequence to be clear-eyed about: on a prose-only guide, which is
the majority of the library, nothing else would ever overwrite it — the only
other writer, `refreshGuidePercentage`, is reached from step- and section-driven
paths a prose-only guide never takes. A reader who wants it gone after a rollback
has "Reset all learning progress" and nothing narrower, because the per-guide
reset affordance is itself gated on the mark counting as progress.

**A bottom-visible completion also writes a 100 that survives a revert** (added
2026-10-29). Seeing the end of a guide with no completable block writes the same
mark and the same 100 as a Mark complete click, with `{ method: 'viewed' }` in
the mark. The durable completion record carries source `objectives`, which the
backend already accepts (the `CompletionRecord` schema allows `objectives`,
`manual` and `skipped`), so the backend needs nothing and nothing has to be
rolled back there. A reverted build does not recognise a `{ method: 'viewed' }`
mark and reads the guide as unmarked: its footer recomputes 0% and offers the
button again, while path progress and My learning keep reading the persisted 100
from `interactiveCompletionStorage` until the reader resets it. The same three reset scopes sweep these marks while
the code is present.

**The mark keys are swept by all three reset scopes, and only while the code is
present.** Resetting one guide clears its mark
(`docs-panel/hooks/resetGuideProgress.ts`); resetting a path clears its members'
(`learning-paths.hook.ts`); "Reset all learning progress" clears the whole
namespace (`MyLearningTab.tsx`). A rollback removes those sweepers along with the
writer, so marks written beforehand stay in localStorage unread — inert, but not
reachable by any in-app control. `syncFromGrafanaStorage`'s `keysToSync` is a
fixed list of exact keys and cannot express a prefix, so the Grafana-side copies
are not reachable either.

**The namespace is uncapped**, matching `sectionAcknowledgementStorage`, the
per-content-key namespace it was modelled on and sits beside. The two bounded
percentage namespaces are a different shape — one shared record each, which is
what `createBoundedRecordStorage` bounds — and giving the mark that shape would
cost the exact-key cross-tab match the store's storage listener depends on.

## What is safe to change vs load-bearing

**Safe:**

- The button labels. "Mark complete" and "Mark complete and continue" are context
  labels, not contract.
- The nudge's copy and frequency — both open, both expected to move.
- Anything about `rollUpGuideStats` other than the claim that it is not a
  completion denominator.

**Load-bearing — changing these re-opens a decision:**

- **The button renders unconditionally** (decision 2). It is no longer the only
  path to 100% (2026-10-29), but any predicate on whether it renders still
  reintroduces the failure the measurements above document. Removal is #2259.
- **Viewed only applies at `completableBlockCount === 0`, or when there is no
  block index.** The producer guard in `markGuideEndViewed`
  (`src/global-state/completion-store.ts`) enforces it. Without it, a reader
  who scrolls past a guide's interactive steps completes it without doing them.
- **The bottom-visible trigger latches once per mount.** The completion panel
  replaces the footer and is taller, which moves the sentinel; re-evaluating
  would flip a finished guide. After a reset it re-arms on the next mount.
- **The trigger waits for settle.** It is armed only after `onContentReady`,
  after every image has loaded or errored, and while the tab is visible, and the
  load backfill waits the 200 ms settle window and records only a load that
  first takes the persisted percentage to 100 (decision 1). Arming earlier counts zero-height
  images and the previous milestone's scroll position as the end of content.
- **The nudge does not block navigation, and fires on any incomplete milestone
  rather than on a prose-only subset** (decision 8).
- **Navigation credits nothing** (decision 6).
- **Path progress consumes percentages, not totals** (decision 4). This is what
  buys the recursion in decision 5 and what retires RFC #14's Option A. A change
  here is not a formula tweak; it pulls the declared-count machinery back in.
- **`src/lib/guide-stats` publishes the denominator and the per-block positions
  together**, so a numerator and a denominator can never come from two traversals
  — see `denominator-position-pairing` in `docs/design/CONCERN_DETAILS.md`.
- **An unresolvable member is excluded from the mean, never scored zero**
  (decision 9), and the join reads `interactiveCompletionStorage` by key
  presence, taking the furthest record in `[0, 100]` across a member's
  candidate keys.

## Related

- `docs/developer/STEP_MODEL.md` — the per-step model, its persistence, and the
  `pathfinder:progress` event. A deliberately separate model with its own
  numerator; converging the two is follow-on work, not implied here.
- `docs/design/CONCERN_DETAILS.md` — the `completion-records` contract anchor
  (#1411 → #1700) and the `completion-denominator-authority` and
  `journey-threshold-membership` named invariants.
- `docs/design/BACKEND_PROXY_PATTERN.md` — how a durable completion record
  reaches the App Platform, and the identity it is keyed on.
- `docs/developer/TELEMETRY.md` — what may and may not be joined when settling
  the bets above.
- `src/lib/guide-stats/block-index.ts` — the counting rule of 2026-08-19, with
  the container and opaque-parent lists.
- `src/lib/guide-stats/completion-affordance.ts` — which block types emit
  completion evidence, and why that is a different question from which render
  interactively.
- `src/global-state/path-member-join.ts` — the content-key join a path member's
  percentage is resolved through, and the unresolved count decision 9 surfaces.
