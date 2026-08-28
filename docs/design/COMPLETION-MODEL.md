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

| Level     | Progress is                                                    | Reaches 100% by                                                    |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Guide     | completed interactive steps over the guide's total block count | reaching the final counted block, or clicking **Mark complete**    |
| Milestone | the same as a guide — a milestone _is_ a guide                 | the same, via **Mark complete and continue**                       |
| Path      | the mean of its milestones' percentages                        | every milestone at 100%                                            |
| Journey   | the mean of its children's percentages, if journeys ever exist | every child at 100% (decision 5 — not built, and not needed to be) |

**A vocabulary warning before you read further.** "Journey" in decision 5 means a
level _above_ paths — a path of paths. That is not what "journey" means in the
code today: `milestoneCompletionStorage` is keyed by `journeyBaseUrl`,
`getLearningJourneyBaseUrl` canonicalizes it, and `rollUpGuideStats` treats "a
path or journey" as one thing with milestones under it. In current code a
learning journey sits at the same level as a path, not above it. If decision 5 is
ever built, that collision has to be resolved first; until then, read "journey"
below as the hypothetical outer level and "learning journey" in code as a path.

Two properties follow that are worth stating before the decisions, because most
of the design pressure comes from them:

- **Prose is unmeasurable.** A paragraph emits no signal. A guide with more prose
  than interactive steps therefore has a coarse percentage, and a guide with no
  interactive steps at all has only two values.
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

## What the library actually looks like

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

**Implementation note for the debugger.** The numerator in `guide-stats/progress.ts`
is the _furthest evidenced position_, not a count of completed steps. The two
coincide because positions are monotonic and reaching position `n` implies
`1..n-1` — that is the point of a position-based numerator, and it is why
preamble that emits no evidence is never individually completable. If you are
chasing a percentage that looks too high, look at `containerEndPositions` and at
which block a section acknowledgement credited, not at a completed-step count.

### Decision 2 — every guide and every milestone ends in a Mark complete button

**Decision.** Every guide and every milestone ends in a button that takes the
reader to 100%. No predicate. No special cases. Labels differ by context only:

| Context   | Label                          |
| --------- | ------------------------------ |
| Guide     | **Mark complete**              |
| Milestone | **Mark complete and continue** |

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

**Where the code stands.** `progress.ts` already models the evidence kind this
button produces — `mark-guide-complete`, which evidences the whole guide
regardless of `blockId` — but there is **no producer for it anywhere in the
repo**. Only the per-section `#842` acknowledgement exists. Until the button
ships, no guide in the library can reach 100% under this model, and 100% is what
triggers badge awards, durable completion records, path progress and the
"continue learning" CTA.

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

**Why record a consequence as a decision.** Because it was stated explicitly and
accepted, rather than discovered later. It is the sharpest edge of decision 1's
trade-off and it applies to 51.5% of the published library. A future reader
finding a wall of 0%-or-100% guides in the warehouse is looking at intended
behaviour, not a bug — and the honest reading of that wall is an authoring
problem, not an arithmetic one.

### Decision 4 — path progress is the mean of its milestones' percentages

**Decision.** A path's percentage is the arithmetic mean of its milestones'
percentages. Milestones are weighted equally regardless of length. See the
[worked example](#worked-example--path-progress).

**Why.** It is the only aggregation that needs nothing a path does not already
have. Milestones are fetched one at a time; a path's step or block denominator is
not knowable when the path opens without either declaring it in the manifest or
fetching every milestone up front. Averaging percentages sidesteps the question:
each milestone knows its own denominator, and only the percentage bubbles up.

**The consequence worth recording.** **No path-wide step total or block total
ever needs pre-calculating.** That is not a minor simplification — it deletes a
whole class of work: no declared step counts to keep honest, no publish-time
recount, no CI parity check, no drift between a stamped total and the content it
counted, and no monotonicity problem when a total changes under a reader mid-path.

**What this means for `rollUpGuideStats`.** `src/lib/guide-stats/summary.ts` sums
a path's milestones into one `GuideStatsSummary`, and the
`completion-denominator-authority` invariant currently anticipates that "the
rollup index lands with the first path-level consumer." Under this decision that
consumer does not arrive: path progress consumes per-guide percentages, not a
summed `blockCount`. The rollup remains valid and useful as a **reporting and
authoring** figure — how big is this path, how much of it is instrumented — but
it is not a completion denominator, and its own docstring's warning (a consumer
recording a percentage against a rolled-up `blockCount` needs its numerator from
somewhere else) should be read as a reason not to, rather than as a gap to fill.

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

**What this changes.** Today's learning-path completion is milestone-click-based:
`calculatePathProgress` in `src/learning-paths/learning-paths.hook.ts` counts
milestones present in a completed-guides list, and `milestoneCompletionStorage`
records milestone slugs. Under this model a milestone reaches 100% the same way a
guide does, and navigation past it does not. This is exactly the baseline the
rejected alternative argues against discarding, so the change is deliberate and
its cost is known: the
existing milestone-click series is not comparable to what comes after it, and any
before/after read across the cutover needs to say which model produced each side.

### Decision 7 — a separate `markCompleteClicked` event ships alongside the completion event

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

### Decision 8 — a teaching nudge on prose-only milestones, which must not block

**Decision.** On a prose-only milestone, when the reader clicks "next milestone"
without having marked the milestone complete, show a small tip or modal teaching
them to mark it complete first.

**It must not block them from moving on.** This is the load-bearing half. The
nudge exists because decision 6 means navigation earns nothing and decision 3
means a prose milestone has exactly one way to earn something; a reader who does
not know that loses their progress silently. A nudge that gated navigation would
turn a teaching moment into a toll, on the population least likely to tolerate one.

**Its frequency, scope and state are open.** See
[open questions](#open-questions).

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
prior click-rate number, because the button has no producer in the repo yet —
this bet's baseline is measured after it ships, not before.

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

**Baseline, 2026-08-28, over 598 published guides:**

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

**The nudge's frequency and scope.** First time in a path, first time ever for
that reader, or every time — and where the per-reader state lives. Every option
has a cost: per-path state multiplies, per-reader-ever state is one more thing a
progress reset must or must not clear, and every-time is a nag.

**Whether the nudge fires only on prose-only milestones.** The alternative is
firing whenever a reader leaves any incomplete milestone. There is a real tension
here and it should not be smoothed over: **restricting the nudge to prose-only
milestones reintroduces the same "sometimes you see it" inconsistency that
justified putting the button everywhere** (decision 2). The counter-argument is
that a nudge is advice and a button is an affordance, and inconsistent advice is
less confusing than an inconsistent control. Unresolved.

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

## What is safe to change vs load-bearing

**Safe:**

- The button labels. "Mark complete" and "Mark complete and continue" are context
  labels, not contract.
- The nudge's copy, frequency, and scope — all open, all expected to move.
- Anything about `rollUpGuideStats` other than the claim that it is not a
  completion denominator.

**Load-bearing — changing these re-opens a decision:**

- **The button is unconditional** (decision 2). Any predicate on whether it
  renders reintroduces the failure the measurements above document.
- **The nudge does not block navigation** (decision 8).
- **Navigation credits nothing** (decision 6).
- **Path progress consumes percentages, not totals** (decision 4). This is what
  buys the recursion in decision 5 and what retires RFC #14's Option A. A change
  here is not a formula tweak; it pulls the declared-count machinery back in.
- **`src/lib/guide-stats` publishes the denominator and the per-block positions
  together**, so a numerator and a denominator can never come from two traversals
  — see `completion-denominator-authority` in `docs/design/CONCERN_DETAILS.md`.

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
