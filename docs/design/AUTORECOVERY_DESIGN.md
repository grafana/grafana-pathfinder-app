# Auto-recovery system design

## Section checkpoints (implemented pilot)

A section can now declare an optional `checkpoint` containing ordered live checks. This is an invariant for the section, separate from historical completion. Conditions must remain valid throughout the section; put a condition that the next action intentionally consumes on that step's requirements instead. Existing guides without checkpoints retain their behavior.

The implementation is based on an October 13, 2026 scan of 724 tracked `content.json` guide files in `interactive-tutorials` (including journey content; excluding assets). These contain 734 sections, 195 with requirements; 1,160 page conditions; 1,716 target-presence conditions; 187 navigation-menu conditions; and 398 form-fill actions. Selector-text heuristics found tab candidates in 78 guide files, dialog candidates in 11, and save/create/delete/install candidates in 74. These candidate counts are authoring leads, not verified DOM compatibility or recovery coverage.

Common patterns and their treatment:

| Catalog pattern                            | Checkpoint support                                                                 | Examples                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Leaving the expected page                  | Existing `on-page:` condition and validated navigation repair                      | Playlist creation; Adaptive Metrics rule management                                    |
| Closing the navigation menu                | Existing `navmenu-open` condition and menu repair                                  | Playlists and dashboard snapshots                                                      |
| Collapsing an options control              | Unique visible control with `aria-expanded`; set false to true once                | Prometheus query options in `dpm-explore-up-metric`                                    |
| Selecting another tab                      | Unique visible button or non-link tab with `aria-selected`; select only when false | Adaptive Logs Patterns/Exemptions/Segments (verify the actual control before adoption) |
| Losing a dialog or editor                  | Visible target check with an objective-driven recovery recipe                      | Alert activity details; query and panel editors                                        |
| Clearing dashboard grouping/filters        | Dashboard state adapter from the filtering pilot                                   | `dashboard-interactive-filtering`                                                      |
| Form input, missing resources, permissions | Read-only requirements and manual instructions; no automatic write replay          | Playlist forms; alert creation; data source setup                                      |

```json
{
  "type": "section",
  "id": "inspect-query-options",
  "title": "Inspect query options",
  "checkpoint": {
    "checks": [
      { "requirement": "on-page:/explore" },
      { "target": "div[data-testid='data-testid prometheus options'] button[aria-expanded]", "state": "expanded" }
    ],
    "manualRecovery": "If the query editor was closed, reopen your Prometheus query, then check again."
  },
  "blocks": []
}
```

List location checks before controls so recovery never clicks a matching control on the wrong page. Target selectors must remain stable when the control changes state: use `[aria-expanded]`, not `[aria-expanded='false']`. Checks support `visible`, `expanded`, and `selected`; visibility never guesses a trigger action. Ambiguous, disabled, or hidden action targets are never clicked. Missing views can declare an explicit recovery recipe. Submit/reset buttons and links are not clicked. Terminal command conditions are excluded because evaluating them can itself write state.

The coordinator checks in order, restores only the first unsatisfied repairable condition, waits for observed readiness, and checks the whole checkpoint again before proceeding. Each condition is repaired at most once per request; drift or verification timeout returns control to the learner. Cancel and unmount stop subsequent repairs. Recovery does not call completion or reset APIs. The section gate polls every five seconds and on focus/history events; the section runner also checks at execution boundaries. Existing automated section click protection remains in use.

A check can declare `recover`, a compact sequence using the existing `button` and `navigate` actions. Each action must have `replaySafe: true` (an author review of repeat safety) and live `objectives`, using the same requirement/target condition shapes as checkpoints. Historical `section-completed:` objectives and command probes are rejected. No automatic import of all preceding steps occurs: resource writes and form overwrites must not be marked replay-safe.

```json
{
  "target": "[aria-label='Legend combobox']",
  "state": "visible",
  "recover": [
    {
      "action": "button",
      "reftarget": "[data-testid='data-testid Query editor row'] button[aria-label$='query row']",
      "replaySafe": true,
      "objectives": [
        {
          "target": "[data-testid='data-testid Query editor row'] button[aria-label$='query row']",
          "state": "expanded"
        }
      ]
    },
    {
      "action": "button",
      "reftarget": "[data-testid='data-testid prometheus options'] button[aria-expanded]",
      "replaySafe": true,
      "objectives": [
        {
          "target": "[aria-label='Legend combobox']",
          "state": "visible"
        }
      ]
    }
  ]
}
```

Recovery checks the final view before every replay action, so already-visible query options never cause their query row to toggle closed. Actions whose live objectives hold are skipped. Earlier checkpoint conditions are rechecked before each action; a failed objective or cancellation stops the sequence. Only verified checkpoint readiness unblocks the learner; replay does not complete learning steps.

The button/navigation handlers expose a recovery path with no teaching tooltips, scrolling animation, completion writes, selector-relaxation retries, or fixed settling sleeps. It advances immediately when objectives hold, waking on DOM changes with a 50 ms fallback for non-DOM state and a five-second verification deadline. Navigation stays inside Grafana and cannot switch guides. Recovery buttons must be unique, visible, enabled, and unable to submit/reset a form; an implicit button outside a form is allowed.

Author checkpoints through JSON mode. They survive JSON import, validation, parsing, and rendering. No automatic catalog migration or recovery inference is performed. No checkpoint state or learner form values are persisted. The two-tab controller currently blocks checkpointed sections with an instruction to open the guide in the Grafana tab, rather than incorrectly checking the controller DOM. A dedicated editor form and live-tab checkpoint transport are follow-up work.

### Recovery storage and OSS

Recovery instructions are part of the guide's JSON, not per-user snapshots or an action log. OSS uses the same frontend coordinator with bundled, CDN, or imported guides; it does not need App Platform or a new local/user-storage fallback for recovery. Cloud stores the same recipe with the authored guide through the existing guide backend. Runtime readiness, the current repair, and cancellation are memory-only and are recomputed from the live page after remount.

Each attempt is bounded by the validated recipe limits (12 checks, 12 actions per check, 12 objectives per action), one repair per condition, and readiness timeouts. Cancellation and unmount abort outstanding work; observers, timers, and window listeners are released. No recovery history, form values, or snapshots are saved, so no TTL or storage migration is needed. Learner-progress storage, saved drafts, and guide-library retention are outside this change.

Recovery appears as a compact inline notice with a single Restore action. Manual guidance and Check again appear only when automatic restoration is unavailable. While the checkpoint blocks a section, duplicate step requirement notices are hidden; they return once the checkpoint is ready.

New content requires a runtime and validator release containing checkpoint support. Cloud persistence also requires the [companion InteractiveGuide CRD schema update](https://github.com/grafana/grafana-pathfinder-backend/pull/107); older backend schemas silently prune `checkpoint` when saving. The deployment script allowlist targets that companion schema. Older runtimes may ignore the field: keep ordinary requirements on critical steps and do not publish checkpoint-dependent guides ahead of those releases.

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
