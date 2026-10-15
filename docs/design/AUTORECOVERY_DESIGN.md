# Auto-recovery system design

## Implicit section recovery (implemented)

When a learner drifts out of the state a section's steps set up, for example by leaving the page or collapsing a control an earlier step opened, the section pauses with a single **Restore** action. Restoring puts the state back and never touches completion. Authors write nothing for this: recovery is derived from each section's own steps.

### Why derived rather than authored

A scan of the 724 tracked `content.json` guides in `interactive-tutorials` (October 2026) found that steps already declare where they run and what they need on screen: 1,009 steps carry `on-page:`, 1,698 `exists-reftarget` and 140 `navmenu-open`. What steps rarely declare is the state of the controls they toggle. None of the 249 `button` steps sets `targetstate`, and only 45 `highlight` steps do. An earlier pilot asked authors to restate the section's state in a `checkpoint` block, which duplicated what the steps imply and was too much to ask; it was removed before release.

### Derivation

For the section's cursor step (the first incomplete step), the plan contains, in order:

1. The cursor step's `on-page:` requirements, repaired with the existing location fix.
2. A target check on the cursor step's `refTarget` (button, highlight, formfill and hover steps; not lazy-render steps), with a recipe of:
   - returning to the URL where the cursor step was last ready, minus Pathfinder's own launch parameters, so Explore queries and dashboard variables survive;
   - replaying earlier toggles: completed `button` or `highlight` steps with a `targetstate`, walking back from the cursor.

The walk stops at anything that may have changed the page in a way recovery cannot repeat: a `navigate`, a click without a `targetstate`, a multistep or guided block, a lazy-render toggle, or an inline conditional between steps. Form fills, hovers, noops, popouts, quizzes, terminal and code blocks pass through, because replay never re-types values; skipped steps pass through because they never ran. Only the latest toggle of a given control and attribute is kept.

A toggle is replayed only if its target resolves to exactly one visible control that `isReplaySafeControl` accepts and whose state can be read; an unreadable state is never clicked blind. `navmenu-open` and `dashboard-*` requirements stay with the step's own **Fix this**, so the learner never sees two fixes for the same thing.

### When a section pauses

- **Active section only.** The flag is on, the section is incomplete and reached (every earlier section is done, or the learner has done a step here), its requirements pass, alignment is not paused, and it is not the two-tab controller.
- **Armed first.** A plan only takes effect after it has passed once for the current cursor step, so a step that has never been ready, a reload, or a section that was never set up is left to the step's own messaging.
- **Something to do.** A failing check pauses only if Restore can act: the page differs from the armed URL, or the first unmet recipe step can be replayed now. Otherwise the step explains itself as before.
- **Confirmed.** Drift must be seen twice at least 700 ms apart, which absorbs renders that briefly remove a control.
- **Never mid-step.** Background checks are suspended while Do Section or a guided interaction is running, and one check runs as soon as it ends.

While paused, the step's own notices are hidden and its actions wait. After a Restore that does not verify, the section stops offering Restore for that check until it passes or a different check fails, and the step's own messaging returns.

When the walk stopped at a step recovery cannot repeat (a click such as Save or Create, a navigation, a multistep or guided block) and the check fails without a Restore on offer, the cursor step's requirement message adds **Set up in step N**. The link scrolls to and briefly highlights that step; it never resets or completes anything. The number is left out ("Set up in an earlier step") when an inline conditional before that step may have taken its number.

Checks run every five seconds, on window focus, and on every in-app navigation (with one follow-up check once the page has rendered). All checks are local URL and DOM reads with no network calls. Only the active section polls.

### Limits

- Recipes never cross sections, and multistep and guided blocks are opaque.
- After a reload nothing is restored until the plan has passed again.
- `on-page:` keeps its substring match, and a target is satisfied by any one matching element, so a loose selector can make recovery report success on the wrong panel.
- Authors get the most from recovery by giving toggle steps a `targetstate`.

The kill switch is `pathfinder.section-recovery` (see `docs/developer/FEATURE_FLAGS.md`). Telemetry is described under "Section recovery events" in `docs/developer/TELEMETRY.md`. Recovery state is memory-only; nothing is persisted, so OSS, bundled, CDN and App Platform guides behave the same.

## Vision

A generalized "Fix this" capability that detects when users diverge from the tutorial happy path, diagnoses what went wrong, and either automatically recovers or guides users back on track - going far beyond the current navigation-only fixes.

## The fundamental problem

Pathfinder tutorials and Grafana UI are **two independent state machines** that can diverge at any moment:

- **Tutorial state**: Current step, completion status, expected UI conditions
- **UI state**: URL, open panels/modals, form values, navigation state, selections

Currently, alignment is only checked at **discrete moments** (step start). Users have full agency over the UI and can diverge at any time - navigating away, closing modals, changing form values, or simply getting distracted.

The current "Fix this" only handles navigation state (`navmenu-open`). A general solution needs to handle the full spectrum of divergence types.

## Divergence classification

### By detectability

| Detectability    | Examples                                          | Approach                        |
| ---------------- | ------------------------------------------------- | ------------------------------- |
| **High**         | URL changes, navigation state, modal presence     | Monitor continuously            |
| **Medium**       | Form values, selected items, panel state          | Check at step boundaries        |
| **Low**          | Side effects of async operations, race conditions | Heuristics only                 |
| **Undetectable** | User intent, mental state, external factors       | Cannot address programmatically |

### By recoverability

| Recoverability  | Examples                                     | Recovery approach                         |
| --------------- | -------------------------------------------- | ----------------------------------------- |
| **High**        | Navigation state, scroll position            | Silent auto-fix                           |
| **Medium-High** | URL/location changes                         | Navigate back (if URL is stable)          |
| **Medium**      | Closed modals, collapsed panels              | Replay triggering action                  |
| **Medium-Low**  | Form state changes                           | Re-inject values (watch for side effects) |
| **Low**         | Ephemeral UI lost mid-multistep              | Restart from checkpoint                   |
| **None**        | Destructive actions (submit, delete, create) | Cannot undo; restart section              |

### The difficulty spectrum

```
Easy ◄─────────────────────────────────────────────────────► Hard

Nav state → Location → Modal → Form state → Destructive actions
   ✓           ~         ○          ○              ✗
Currently    Partial   Not        Not           Cannot
handled      infra     handled    handled       recover
```

## Initial-state alignment

The divergence model above assumes the tutorial and UI state machines **start aligned** and then drift apart during execution. But non-contextual launch surfaces — the home page, URL params (`?doc=...`), and learning path transitions — break this assumption entirely. The two state machines were **never aligned in the first place**.

### The implicit contract the recommender provides

The recommender panel filters guides by the current URL (via `index.json` `url` field matching in `ContextService.getBundledInteractiveRecommendations`). This means the user is already on the correct page when they launch a guide. It's a silent alignment guarantee that guides have come to depend on without declaring it.

For example, a guide with `url: ["/explore"]` in the index only appears when the user is on the Explore page. Its first step can safely assume `on-page:/explore` is satisfied. When that same guide is launched from the home page (`/a/grafana-pathfinder-app`), the assumption breaks.

### Launch context

Different launch surfaces provide different initial-state guarantees:

| Launch context                 | Location pre-aligned?                               | Action needed                 |
| ------------------------------ | --------------------------------------------------- | ----------------------------- |
| **Recommender**                | Yes — guaranteed by URL filtering                   | None                          |
| **Home page**                  | No — user is on `/a/grafana-pathfinder-app`         | Navigate to starting location |
| **URL param** (`?doc=...`)     | No — could be any page                              | Navigate to starting location |
| **Learning path** (next guide) | Maybe — depends on previous guide's ending location | Check and navigate if needed  |

Launch context is already partially tracked (`sidebarState.setPendingOpenSource('home_page')`) but isn't connected to recovery logic. Making it a first-class input to the recovery system lets the "implied 0th step" fire only when needed.

### Guide resilience spectrum

Not all guides are equally affected. There are three patterns:

1. **Self-navigating guides** (resilient): Step 1 is "navigate to X" via nav menu highlight with `requirements: ["navmenu-open", "exists-reftarget"]`. These work from any starting page because they establish their own location. Example: `first-dashboard.json`.

2. **Explicitly gated guides** (degraded UX): Early steps have `on-page:/path` requirements. The existing `fixType: 'location'` infrastructure catches this, but the user launches a guide and immediately hits "Fix this" — a jarring experience from a home page where they expected a smooth start.

3. **Implicitly gated guides** (broken): Early steps have `exists-reftarget` but no `on-page` requirement, relying on the recommender to ensure the element exists. From the home page, the target element is absent and the failure message is confusing.

### The implied 0th step

Before step 1 begins, verify and establish the guide's starting conditions. This is the "implied 0th step" (from colleagues) applied to launch context:

- **Detection**: Compare current location against the guide's expected starting location (from the guide's `startingLocation` field in `manifest.json` for packages with manifests, or falling back to `index.json` `url` field for unmigrated guides). App Platform guides carry the value under `manifest.additionalFields.startingLocation` instead, because the `InteractiveGuide` CRD declares no top-level field for it — `docs/developer/EXTERNAL_API.md` owns that two-location rule and the launch routes it reaches. Wherever it comes from, the resolved value passes `validateInternalNavigationPath` before it can become a prompt: confirming the prompt pushes it as a route, so it clears the same same-origin and denied-route bar as an authored `navigate` action. A value that fails resolves to `null` — no prompt — rather than to that validator's `/` fallback, which would steer the reader to the home page.
- **Level 0 (silent)**: Navigate to the starting location automatically as part of the launch sequence. User clicks "Start guide" on the home page, lands on `/explore`, sees step 1 ready.
- **Level 1 (prompted)**: Show a brief prompt: "This guide starts on the Explore page. Navigate there?" Appropriate when the navigation would be disorienting.
- **No-op**: If the guide is self-navigating (step 1 handles location), skip the implied 0th step entirely.

### Schema considerations

The starting location is currently implicit — derived from the recommender's URL matching. As part of the package design (Phase 3 pilot migration), **`startingLocation` is being added as a formal field in `manifest.json`**:

```json
{
  "id": "prometheus-grafana-101",
  "startingLocation": "/connections",
  "targeting": {
    "match": { "urlPrefixIn": ["/connections"] }
  }
}
```

**Field specification:**

- Type: `string` (URL path)
- Default: `"/"` (root page)
- Validation: WARN if missing
- Purpose: Declares where the guide expects to execute before step 1, independent of where it's recommended

**Migration strategy:**
The `migrate-journeys` CLI tool (package implementation Phase 3) extracts starting location from existing `index.json` `url` field or `targeting.match` URL rules and populates `startingLocation` in generated manifests. This provides a bridge from the current implicit model to the explicit schema.

**Bridge period behavior:**
Until all guides are migrated to the package format with manifests, the recovery system continues to infer starting location from `index.json` `url` field as a fallback. This ensures guides work regardless of migration status.

**Relationship to step-level requirements:**
Both guide-level `startingLocation` (pre-execution requirement) and first-step `on-page:/path` requirements (step-level gate) can coexist. Best practices for when to use each are being determined during migration. Guides that are self-navigating (step 1 handles location) may not need `startingLocation` at all.

### Best practice for guide authors

Guides that establish their own starting state (self-navigating pattern) are inherently robust across all launch contexts. The implied 0th step is a safety net, not a substitute for well-structured guides. New guides should prefer starting with a navigation step when possible, treating the recommender's location guarantee as a convenience rather than a contract.

## Graduated recovery system

### Level 0: Silent auto-recovery

- Navigation state (menu open/docked) - _currently implemented_
- Scroll position adjustments
- Minor UI state corrections

User experience: Invisible. Tutorial just works.

### Level 1: Prompted auto-recovery

- Location changes (navigate back)
- Modal re-opening
- Form value restoration

User experience: "Fix this" button appears. One click to recover.

### Level 2: Guided manual recovery

- Step-by-step instructions when automation fails
- "You've navigated away. Click here to return."
- Contextual help for complex recovery

User experience: User follows simple instructions to recover.

### Level 3: Checkpoint restart

- Restart from last stable point
- Automatically re-execute recoverable steps
- Skip already-completed objectives

User experience: "Let's go back to where things were working."

### Level 4: Section/tutorial reset

- Clear progress and start fresh
- Explain why reset is needed
- Preserve learning context

User experience: "This section needs to restart. Here's why..."

## Multistep complexity

Multistep actions present unique challenges:

1. **Atomic execution**: All-or-nothing; no partial completion
2. **Transient states**: Intermediate states (open dropdowns, focused inputs) are ephemeral
3. **Commit points**: Some actions are irreversible (form submission)

Key insight: Not all actions within a multistep are equal. A dropdown opening is ephemeral; clicking Submit is a commit point. Recovery strategy depends on where divergence occurs relative to commit points.

- **Pre-commit divergence**: Restart multistep from beginning
- **Post-commit**: Step is effectively complete; checkpoint for next step
- **Mid-commit**: Complex; may require manual intervention

## Infrastructure needs

### Checkpoint system

- Capture UI state at step boundaries (URL, open modals, form values, nav state)
- Store in session storage for recovery
- Mark "stable" checkpoints that can reliably be returned to

### Divergence monitor

- URL change detection (history API)
- Key element presence (targeted MutationObserver)
- Periodic checkpoint validation
- Configurable sensitivity to avoid false positives

### Recovery engine

- Decision tree for selecting recovery strategy
- Recovery action executors for each divergence type
- Graceful degradation when recovery fails

### Guide schema extensions

- Recovery hints from guide authors
- Commit point annotations for multistep actions
- Stable URL markers

## Phased approach

**Phase 1 - Foundation**: Checkpoint capture/storage, URL divergence detection, location-based "Fix this", initial-state alignment for non-contextual launch surfaces (home page, URL params). Initial-state alignment implementation uses `startingLocation` from package manifests (available in package format Phase 3+) or infers from `index.json` `url` field for unmigrated guides.

**Phase 2 - Modal recovery**: Track modal opens, store triggers, implement replay

**Phase 3 - Continuous monitoring**: Divergence monitor, graduated severity, return-to-tutorial prompts

**Phase 4 - Multistep hardening**: Commit point annotations, pre-commit checkpointing, retry from checkpoint

**Phase 5 - Full recovery engine**: Decision tree, automatic strategy selection, graceful degradation

## Key constraints

- **Performance**: Continuous monitoring has overhead; must be targeted and efficient
- **False positives**: Grafana UI is dynamic; not all changes are divergence
- **User agency**: Sometimes divergence is intentional; don't be too aggressive
- **Stable URLs**: Not all Grafana states have stable URLs; some recovery paths won't work

## Context

This design emerged from a Slack discussion (Feb 2026) about navigation issues in tutorials. The pattern of using `requirements: ["navmenu-open"]` with multistep actions works but is limited. Colleagues asked why the system can't auto-fix as an "implied 0th step" - this design answers that question with a comprehensive vision.

The current `fixRequirement()` infrastructure in `step-checker.hook.ts` proves the pattern works; this design generalizes it beyond navigation to handle the full spectrum of divergence types.
