# Feature flags in grafana-pathfinder-app

This document explains how feature flags are implemented in the grafana-pathfinder-app plugin using the OpenFeature SDK and Grafana's Multi-Tenant Feature Flag Service (MTFF).

## Overview

The plugin uses the [OpenFeature](https://openfeature.dev/) standard with the OFREP Web Provider to evaluate feature flags dynamically at runtime via Grafana Cloud's MTFF service. This approach:

- Leverages a vendor-neutral open standard (OpenFeature)
- Supports boolean, string, number, and object-valued flags
- Enables A/B experiments with variant assignment and targeting
- Provides domain-isolated evaluation (does not conflict with Grafana core or other plugins)
- Includes automatic analytics tracking via `TrackingHook`

## Current feature flags

### `pathfinder.package-browser`

**Type**: Boolean

**Default**: `true`

Controls the sidebar Browse entry and Browse all links. Set it to `false` to hide browsing during rollout. Browse offers starter content, topic shortcuts, and the full catalog. The browser uses existing package metadata and performs no prerequisite assessment. The `/browse` route opens the sidebar browser and returns to My learning.

**Tracking key**: `package_browser`

---

### `pathfinder.sidebar-hub`

**Type**: Boolean

**Default**: `false`

Swaps the content of the sidebar's Recommended tab for the learning hub: a welcome header with a My learning button, the top recommendation, a resume card for the path in progress, three count tiles (assignments, in progress, completed) that open My learning, a "More recommended" list, and a compact help footer. Tabs and the tab bar are unchanged. With the flag off the existing Recommended tab renders as before.

The hub is read in `ContextPanelRenderer`. A temporary Custom guides section lists the organization's published guides and paths (three rows, then Show all) so the hub keeps parity with the old tab. The "Other documentation" list, per-card details (modules, prerequisites, related guides) and the interactive-learning banner experiment's own placement are not rebuilt in the hub yet.

**Tracking key**: `sidebar_hub`

---

### `pathfinder.enabled`

**Type**: Boolean

**Purpose**: Global kill-switch for the Pathfinder plugin during cloud-wide rollout. This is separate from the A/B experiments — it controls whether Pathfinder is available at all for a given stack.

**Default**: `true` (Pathfinder loads normally if the flag is not set)

**Behavior**:

- **`true`**: Pathfinder loads normally — sidebar is available, experiments run as configured
- **`false`**: Plugin is dismounted, the native Grafana help menu takes over

**Important**: This is the only flag that gates whether Pathfinder mounts. It is evaluated independently of the experiments: setting `pathfinder.enabled` to `false` dismounts the plugin and starts none of them; when `true`, they apply as normal. A headless image-renderer session (the page's user has `authenticatedBy: 'render'`) is treated the same as `false` and never reads tenant settings. Detection uses the render key, not the `render=1` query parameter, so a person who opens a render URL in a normal browser still gets Pathfinder.

**Tracking key**: `pathfinder_enabled`

---

### `pathfinder.frontend-telemetry`

**Type**: Boolean

**Purpose**: Remote kill-switch for the Faro telemetry stream (errors, sessions, views, logs, and the analytics-event mirror). Independent of `pathfinder.enabled` — this stops the telemetry, not the plugin. Telemetry is already gated to Grafana Cloud; the flag exists so the stream can be cut fleet-wide without a release if the collector or the filtering misbehaves.

**Default**: `true` (telemetry runs if the flag is not set, and if MTFF is unreachable)

**Behavior**:

- **`true`**: `initFaro()` runs, subject to its own Grafana Cloud / analytics-enabled / hostname gates
- **`false`**: the Faro SDK chunk is never even imported

**Tracking key**: `frontend_telemetry`

---

### `pathfinder.session-replay`

**Type**: Boolean

**Purpose**: Records a masked rrweb session replay of the page, so a guide that goes wrong can be watched back rather than reconstructed from events. Requires `pathfinder.frontend-telemetry`, which owns the Faro instance the recording rides on.

**Default**: `true` (recording happens if the flag is not set, and if MTFF is unreachable)

**Behavior**:

- **`true`**: the recorder is registered the first time Pathfinder is opened in any surface, and runs for the rest of the page — including after Pathfinder is closed again
- **`false`**: neither the replay module nor the rrweb bundle is fetched

**This flag is read once, at plugin bootstrap.** Flipping it to `false` stops _new_ recordings; a tab that is already recording carries on until it is reloaded or closed, and recordings already ingested are unaffected. See [Stopping a recording](TELEMETRY.md#stopping-a-recording) for why, and for what the actual remediation path is.

**Important**: this is an off-switch, not an opt-in — recording is the default state on every Cloud stack where telemetry is enabled. Two consequences worth holding onto:

1. **Never let this run alongside Grafana core's own recorder.** Core ships one behind the `faroSessionReplay` toggle, which is `@default false` in `@grafana/data` — so there is no automatic default-state collision; it takes an operator deliberately enabling core's toggle on a stack that also has this flag on. The consequence if that happens is real: two rrweb instances on one page double DOM serialization per mutation, and rrweb's global proxy of `CSSStyleSheet.prototype.insertRule` is not idempotent-guarded, so they compound on Emotion's hot path. `resolveSessionReplayOptions` yields automatically when `config.featureToggles.faroSessionReplay === true`, but that toggle is private-preview and may not be surfaced to the frontend at all, so still set `pathfinder.session-replay` to `false` on any stack where core's goes true.
2. Recordings are only playable on a stack with Grafana's private-preview Session Replay enabled. That is already on for the ops stack Pathfinder reports to; elsewhere the events are ingested with no UI to view them.

See the privacy invariants in [`TELEMETRY.md`](TELEMETRY.md) for what masking does and does not cover.

**Tracking key**: `session_replay`

---

### `pathfinder.session-replay-sampling-rate`

**Type**: Number

**Purpose**: Volume dial on top of `pathfinder.session-replay` — the fraction of replay-eligible sessions that actually get recorded. Every rrweb event becomes a Faro event carrying a JSON DOM payload, and a Grafana dashboard mutates continuously, so this is the knob to reach for if collector volume becomes a problem before reaching for the switch.

**Default**: `1` (record every eligible session)

**Behavior**: the decision is a deterministic hash of the session id, so a session either has a recording for its whole life or never does — you never get half a replay. `0` records nobody, same net effect as setting `pathfinder.session-replay` to `false`, the difference being intent: the boolean says "off", the rate says "sampled out".

**Important**: this is a remote number, so it can arrive as anything. `resolveSamplingRate` in `src/lib/telemetry/replay.ts` range-checks it at the point of use and **falls back to `1`** for anything that isn't a finite number in `[0, 1]` — a `100` meant as a percentage, a string from a mistyped MTFF value, `NaN`. An earlier Faro sample-rate flag was deleted rather than clamped ([#1275](https://github.com/grafana/grafana-pathfinder-app/pull/1275)) precisely because a fat-fingered value was indistinguishable from a deliberate one; failing to the default rather than to zero is what earns this one its place.

**Tracking key**: `session_replay_sampling_rate`

---

### `pathfinder.auto-open-sidebar`

**Type**: Boolean

**Purpose**: Controls whether the sidebar automatically opens on first Grafana load per session. Users can always change this setting afterwards via plugin configuration.

**Default**: `false` (uses `DEFAULT_OPEN_PANEL_ON_LAUNCH` constant from `src/constants.ts`)

**Behavior**:

- **`true`**: Sidebar auto-opens on first page load per session
- **`false`**: Sidebar only opens when the user explicitly requests it

**Important**: the flag and the `openPanelOnLaunch` plugin setting are a plain OR — either one on is enough, and neither can veto the other (`setupConfigAutoOpen` in `src/utils/sidebar-auto-open.ts`). So on a stack where this flag is on, an admin who turns `openPanelOnLaunch` off does not stop the auto-open; only turning the flag off does. Nothing reads the flag into the setting's default, and `openPanelOnLaunch` falls back to `DEFAULT_OPEN_PANEL_ON_LAUNCH` on its own.

**Behavior on launch**: When enabled, the sidebar auto-opens on each Grafana load (deferred past the onboarding flow as described below). There is no persistent "already shown" suppression — the toggle simply reflects whether the panel opens on launch. This config-driven auto-open lives in `src/utils/sidebar-auto-open.ts`.

**Onboarding flow integration**: If a user first lands on the setup guide onboarding flow (`/a/grafana-setupguide-app/onboarding-flow`), the plugin defers auto-open. It listens for navigation events via `locationService.getHistory().listen()` (with a `popstate` fallback) and triggers auto-open when the user navigates away from onboarding to normal Grafana pages.

**Tracking key**: `auto_open_sidebar`

---

### `pathfinder.coda-terminal`

**Type**: Boolean

**Purpose**: Turns the Coda sandbox terminal on for a stack without either of the two manual steps it otherwise needs — adding a user to the dev-mode allowlist, and ticking `enableCodaTerminal` on the configuration page (a section that is itself hidden behind dev mode). Nothing provisions those fields, so before this flag there was no way to enable Coda except by hand.

**Default**: `false`

**Behavior**:

- **`true`**: `isCodaTerminalEnabled` returns true for every user on the stack, whatever dev mode and `enableCodaTerminal` say. The terminal panel mounts, sandbox-backed blocks (`terminal`, `terminal-connect`, `challenge`) offer their controls, and the block-editor palette lists the Coda block types.
- **`false`**: enablement falls back to dev mode **and** `enableCodaTerminal`, both required.

The effective gate is one accessor, `isCodaTerminalEnabled` in `src/utils/coda-enablement.ts`:

```
flag || (isDevModeEnabled(config, userId) && enableCodaTerminal)
```

**The default has to stay `false`.** The Coda app plugin is not a declared dependency, so enablement is what authorizes the runtime probe for it. On a stack without `grafana-coda-app`, that probe 404s on every page load — see the probe-discipline rule in [`CODA.md`](CODA.md#availability-gating).

**On the configuration page the flag is display-only.** The Coda section appears without dev mode, with its toggle on and disabled, labelled as flag-driven. A save still writes the stack's own `enableCodaTerminal`, so turning the flag back off restores whatever the admin had set rather than leaving the stack silently enabled. `ConfigurationForm.coda-flag.test.tsx` pins that.

**Tracking key**: `coda_terminal`

---

### `pathfinder.intercept-docs-links`

**Type**: Boolean

**Purpose**: Turns on global docs-link interception for a stack, so a grafana.com docs link clicked anywhere in Grafana opens in Pathfinder instead of a new tab. Before this flag the only switch was the experimental `interceptGlobalDocsLinks` tenant setting, which an admin had to find and enable by hand.

**Default**: `false`

**Behavior**:

- **`true`**: interception is on, whatever `interceptGlobalDocsLinks` says.
- **`false`**: interception follows `interceptGlobalDocsLinks`.

The flag and the setting are a plain OR, applied once settings resolve in `src/module.tsx` (`applySettings`). The flag can turn interception on but never off; an admin opt-in stays on regardless of the flag. OSS and self-managed stacks have no OFREP provider, so there only the setting applies.

**On the configuration page the flag is display-only.** The "Global link interception" toggle shows as on and disabled, labelled as flag-driven, and a save never writes the forced value. Turning the flag off restores whatever the stack had set. `ConfigurationForm.intercept-flag.test.tsx` pins that.

**What interception does with a click** (`src/global-state/link-interception.ts`):

- It ignores modified clicks, middle clicks, `#` and `download` links, links inside Pathfinder content, and Grafana `?kiosk` mode, so the browser handles those.
- It only takes plain docs pages: grafana.com `/docs/` and `/tutorials/` pages and interactive guides whose query string is empty or only `utm_*` tracking parameters. Filtered or searched listings such as `/docs/grafana-cloud/whats-new/?tags=IRM`, the `/docs/` home, and the What's new section (which now redirects to grafana.com/whats-new/) open in the browser.
- It hands the link to whichever surface accepts it: the sidebar, floating, or full-screen `useAutoOpenListener` cancels the event to accept.
- If no surface accepts the link in sidebar mode, it opens the sidebar and queues the link.
- In any other mode it lets the browser follow the link rather than swallow the click.

**Tracking key**: `intercept_docs_links`

---

### `pathfinder.section-recovery`

**Type**: Boolean

**Purpose**: Remote kill switch for implicit section recovery, which pauses a section the learner drifted out of and offers Restore (see `docs/design/AUTORECOVERY_DESIGN.md`).

**Default**: `true`. OSS stacks have no flag provider, so recovery is always on there.

**Behavior**:

- **`true`**: active sections derive a recovery plan from their steps and may pause with Restore.
- **`false`**: no plan is derived, nothing polls, and sections behave as before recovery existed.

The flag is read once per page load (`src/utils/section-recovery-enablement.ts`), so a flip takes effect on the next reload. Registering it in MTFF needs both `flags/` and `flag-definitions.libsonnet` in `grafana/deployment_tools`, marked `Public()`, with the default kept `true` to match the registry.

**Tracking key**: `section_recovery`

---

### `pathfinder.progress-analytics`

**Type**: Boolean

**Purpose**: Remote kill switch for `pathfinder_guide_progress` and attempt correlation on terminal completion events (RudderStack, mirrored to Faro).

**Default**: `false` (no progress analytics events when the flag is absent or MTFF is unreachable)

**Behavior**:

- **`true`**: `guide_progress` fires at first real progress and at 25%, 50%, and 75% crossings, at most four times per attempt. The existing `guide_completed` event also carries `attempt_id` for a bundled or standalone guide.
- **`false`**: progress events stop, and terminal events omit `attempt_id`. Guide attempts still persist on the device. Durable completion writes are unaffected.

Terminal completion analytics keep their separate guard and do not depend on this flag or durable write acceptance. Attempt tracking does not emit a second terminal event.

The flag is read each time an event would fire, so a flip takes effect without a reload once the provider has the new value. Implementation: `src/completion-records/progress-analytics.ts`.

**Tracking key**: `progress_analytics`

---

### `pathfinder.progress-records`

**Type**: Boolean

**Purpose**: Saves guide progress as it happens. With the flag on, a new guide attempt is minted in `records` mode, and its partial percentages are written to one durable CompletionRecord per attempt, raised in place until the guide is complete.

**Default**: `false`

**Behavior**:

- **`true`**: a new attempt uses `records` mode when the installed plugin backend also reports `progressRecords: true` on `/completion-records/capability`. Partial progress is queued (debounced 10 seconds), and the completion at 100% updates the same record.
- **`false`**: new attempts use `analytics` mode and send the original create-only completion body. Existing records-mode attempts keep their identity for the final 100% write. The observer stops new partials, and the queue removes unsent partials before transmission.

The flag does not cancel requests already in flight. Each tab uses its locally available flag value. Stale tabs can continue partial writes until they receive the disabled value or reload.

Capability discovery makes no requests while this flag is false. The controller checks the local flag every five seconds until enabled. Unknown capability retries with exponential backoff and jitter, capped at five minutes. Invalid capability responses remain unknown and do not remove queued partials.

Local attempts still persist under `grafana-pathfinder-app-guide-attempt-` when both progress flags are false. Each key includes the current user and organization, matching the write queue owner. Resets affect only that owner's attempts. These device-local keys do not use user-storage synchronization. Without a valid owner, attempts do not persist or use records mode.

Old unscoped attempt keys remain unused because their owner is unknown. The app neither adopts nor deletes them during an owner's reset. The separate analytics flag controls remote events. See [Telemetry](TELEMETRY.md#guide-progress-events).

**Before enabling the flag:**

1. Deploy the CompletionRecord schema with optional `completedAt`.
2. Deploy partial-aware collation and attempt upserts to every serving plugin replica.
3. Verify that partial progress followed by 100% produces one record and satisfies an assignment on the deployed stack.

Costa confirmed in Slack that Viewer OBO receives the required permissions through the RBAC permission set, as reported by Tom. This resolves the permission-model question. The live end-to-end check remains separate. A 403 still disarms the session's write queue and retains items until retry or the 30-day expiry. There is no create-only fallback for failed attempt updates.

Records-mode minting requires the browser Web Locks API. Minting, completion, and reset share one origin-wide lock. Browsers without this API create analytics-mode attempts and retain the legacy completion path. A lock-acquisition failure also disables new records-mode attempts for that session. Reset removes unsent partials for that guide. Send-time checks also reject partials whose attempt is no longer current.

**Do not roll back the plugin by disabling the flag alone.** Older readers count existing partials as completions. Follow the [rollback procedure](../design/BACKEND_PROXY_PATTERN.md#rollout-and-rollback-of-attempt-records), including writer quiescence and partial-record cleanup.

Implementation: `src/completion-records/guide-attempts.ts`, `progress-records-capability.ts`, and `completion-write-queue.ts`.

**Tracking key**: `progress_records`

---

### `pathfinder.passive-completion`

**Type**: Boolean

**Purpose**: Fleet kill switch for passive guide completion — the renderer-owned completion coordinator that observes objectives and the reader's own actions while a guide is open (`src/components/content-renderer/completion-observation-provider.tsx`).

**Default**: `true`

**Behavior**:

- **`true`**: passive completion runs unless the tenant stored `enableAutoDetection: false` (the **Automatic completion** setting), which is the per-tenant opt-out.
- **`false`**: no coordinator is provided. Steps complete only through their own objective checks, Show me, Do it, and Mark complete, as before passive completion; no passive polling, DOM observation or pop-out observation subscriptions run.

The provider reads the flag when it renders, so a flip applies to guides opened after the new value arrives. The flag only becomes operable once it is registered in deployment_tools; until then every stack gets the default.

**Tracking key**: `passive_completion`

---

### `pathfinder.recommend-completions`

**Type**: Boolean

**Purpose**: Gate for attaching the user's completion history to `POST /api/v1/recommend`. See [Completion history in recommend requests](engines/context-engine.md#completion-history-in-recommend-requests).

**Default**: `false`. The flag ships off until privacy and product sign-off and the terms notice cover completion history (tracked separately from this feature).

**Behavior**:

- **`true`**: each recommend request carries a `completions` object built from `GET /completion-records/my`, when that route reports the feature available.
- **`false`**: no `/completion-records/my` request is made for recommendations and the request body has no `completions` key.

The flag is read each time a recommend request is built, so a flip takes effect on the next request. Turning it on, or off again during an incident, reaches browsers only once a `flags/` file and a `Public()` entry in `flag-definitions.libsonnet` exist in deployment_tools.

Implementation: `src/context-engine/recommend-completions-attachment.ts`.

**Tracking key**: `recommend_completions`

---

### `pathfinder.auto-open-guide-experiment`

**Type**: Object (`AutoOpenGuideConfig`), run on `@grafana-experiments/sdk@0.3.0`

**Purpose**: A/B test whether opening Pathfinder with a relevant guide, on a page the operator chose, gets more people to start and finish that guide. Treatment pops the guide open; control keeps today's behaviour. It replaces the retired `pathfinder.highlighted-guide-experiment`, whose two arms both auto-opened and differed only by guide.

**Default**: `{ "variant": "excluded" }`

**Payload**:

```typescript
interface AutoOpenGuideConfig {
  variant: 'excluded' | 'control' | 'treatment';
  experiences: Array<{
    guide: string; // Anything `findDocPage` resolves: 'bundled:<id>', 'api:<id>', or an allowlisted docs / interactive-learning URL
    pages: string[]; // Path patterns for this guide, `matchPathPattern` syntax (trailing `*` matches on a segment boundary)
  }>; // 1 to 3 experiences
}
```

```json
{
  "variant": "treatment",
  "experiences": [
    { "guide": "https://grafana.com/docs/learning-journeys/drilldown-logs/", "pages": ["/explore*"] },
    { "guide": "bundled:first-dashboard", "pages": ["/dashboards", "/dashboard/new*"] }
  ]
}
```

| Variant     | On a matched page                                                                          |
| ----------- | ------------------------------------------------------------------------------------------ |
| `excluded`  | Nothing. Not enrolled, no exposure.                                                        |
| `control`   | Enrolled and counted; Pathfinder stays closed and the context panel is unchanged.          |
| `treatment` | Enrolled; Pathfinder opens with the guide as a tab, and the guide leads the Featured slot. |

**Validation is whole-payload.** An unknown variant, zero or more than three experiences, an experience with no pages, or a guide `findDocPage` cannot resolve rejects everything: nobody is enrolled, behaviour stays as today, and the plugin logs one `warn` per page load with a low-cardinality reason (`unknown_variant` or `invalid_shape`), never the payload. Because guides are resolved against the running build, a guide only newer builds ship is rejected by older ones — check for that `warn` after a rollout. An `unavailable` SDK result (for example no Faro session yet) also logs one `warn` per reason. The first unoffered experience in array order whose pages match wins.

**Enrollment seam.** The SDK's `activate()` is the exposure, and it runs only when every condition holds — the same conditions in both arms, so control is counted exactly when treatment would have popped out:

1. The path matches an experience whose guide this browser has not been offered yet.
2. Pathfinder is closed (`isPathfinderOpen()`), and no plugin has the extension sidebar docked.
3. There is no `?doc=`, `?controller=1`, or kiosk mode on the URL.
4. The tab is visible.
5. Frontend telemetry is on, the user is signed in, and analytics is enabled. Without Pathfinder's Faro instance the SDK cannot start, so a stack with `pathfinder.frontend-telemetry` off enrolls nobody.

It is checked at boot, on every SPA navigation, and when a hidden tab becomes visible. **One activation per visit**: a visit lasts while the set of experiences matching the path stays the same, so moving between sub-paths of one pattern (`/explore` → `/explore/metrics`) never offers an overlapping experience; leaving the matched pages starts a new visit, and the visit survives a reload of the tab (sessionStorage), so a refresh never offers a second overlapping guide. The activation counts toward the visit whatever it resolves to — except one cancelled because the tab went hidden, which retries when the tab is visible again — so a result that offers nothing cannot re-trigger itself. The payload is pre-read with a plain `getObjectValue` to test those conditions; that read is not an exposure because the flag has **no `trackingKey`** — the SDK owns the single `experiment_viewed` denominator, as with the Help button nudge. A call-site tripwire in `src/utils/experiments/enrollment-boundary.test.ts` pins where the experiment can be started and where its flag is read.

**Once per browser per guide.** On activation, both arms write a localStorage marker keyed `{hostname}:{guide}` (`StorageKeys.AUTO_OPEN_GUIDE_SHOWN_PREFIX`). Changing a guide in the flag re-arms that experience. A browser that already holds a marker for a configured guide restores its arm at boot from the flag, without activating — so its guide events keep carrying the arm after a reload, and **`experiment_viewed` fires only at an offer**. Exposure counts are per SDK session, so key per-offer analysis on `pathfinder_auto_open_guide_eligible`.

**Measurement.** Experiment ID `pathfinder-auto-open-guide-v1`, group `matched-page-closed-panel`. Each offer emits `pathfinder_auto_open_guide_eligible` in both arms, with `experiment_auto_open_guide`, `exposure_id`, `event_id`, `experience_index` (0–2), and `opened` (false for control, and for treatment when the panel could no longer pop out by the time activation resolved). The SDK owns that event's Faro mirror. Once activated, the arm also rides `getActiveExperiments` enrichment and the Faro session cohorts, so `docs_panel_interaction`, `guide_progress`, and `guide_completed` carry it — those are the outcome. Guide tabs opened by treatment use the `auto_open_guide_experiment` `LaunchSource` (aligned by construction, no alignment prompt). The closed-surface Faro gate admits this experiment's exposure and eligible event, because control users never open Pathfinder.

**Interaction with the Help button nudge.** Treatment opens Pathfinder, which makes that page load ineligible for `pathfinder.help-button-nudge-experiment`. Don't target the same stacks with both.

**Code**: [`src/utils/experiments/auto-open-guide/`](../../src/utils/experiments/auto-open-guide/), with constants in `src/constants/auto-open-guide-experiment.ts`.

**Retirement** removes the registry entry, `auto-open-guide/` and its bootstrap call in `module.tsx`, the constants file, the `AUTO_OPEN_GUIDE_SHOWN_PREFIX` storage key, the `auto_open_guide_experiment` launch source, `UserInteraction.AutoOpenGuideEligible`, the Featured-slot injection in `context.service.ts`, the `active-experiments.ts` entry, the debug getters, the Faro gate entries, the tripwire block, these docs, and the remote flag.

### `pathfinder.interactive-learning-banner-experiment`

**Purpose**: A/B test whether an explanatory banner increases engagement with interactive guides.

**Type**: `object` (experiment flag — object-valued so it emits exposure events)

**Default**: `{ variant: 'excluded' }`

**Shape**: variant-only. There is no page targeting — the banner explains Pathfinder itself, not the underlying Grafana page.

```typescript
interface InteractiveLearningBannerConfig {
  variant: 'excluded' | 'control' | 'treatment';
}
```

**Variant behavior**:

| Variant     | Banner | Notes                                                                       |
| ----------- | ------ | --------------------------------------------------------------------------- |
| `excluded`  | No     | Not in the experiment. Identical to pre-experiment behavior.                |
| `control`   | No     | In the experiment, no banner. Identical rendering to `excluded`.            |
| `treatment` | Yes    | Dismissible explanatory banner on the context page and above opened guides. |

A rejected payload (not an object, missing `variant`, or an unknown arm) falls back to `excluded`, so a fat-fingered MTFF value enrolls nobody.

**Exposure timing.** This flag is read lazily by `enrollInteractiveLearningBannerExperiment` when a Pathfinder surface first opens, because "entered the experiment" should mean "had the chance to see the banner". Evaluating the flag is what emits the exposure, so the call site is the timing contract — `src/utils/experiments/enrollment-boundary.test.ts` pins the allowed call sites for that reason. `getActiveExperiments` reads the memoised arm rather than evaluating, so analytics enrichment can never enroll a user who has not opened Pathfinder.

**Two placements, three surfaces.** The banner renders in two places, and `surface-coverage.test.ts` pins both against the enrollment seams:

| Placement      | Where                                                                                 | Surfaces                                                     |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `context-page` | Above the profile bar on the recommendations list (`context-panel.tsx`)               | Sidebar only — floating and full-screen have no context page |
| `guide`        | Above rendered guide content (`DocsPanelContentArea.tsx`, `FloatingPanelContent.tsx`) | Sidebar, floating, and full-screen                           |

The `guide` placement is the one that matters for reach: a guide opened by `?doc=`, a deep link, or the auto-open guide experiment never passes through the context page, so without it the users least likely to know what "Show me" does are exactly the ones who never see the explanation. Copy is identical in both placements; only `interaction_location` differs (`interactive_learning_banner` vs `interactive_learning_banner_guide`), so the readout can tell where it was first seen.

The two placements are never mounted simultaneously — the sidebar's content area is an if/else on the recommendations tab, and the other surfaces have no context page — so the dismissal needs no cross-instance plumbing. It is one hostname-scoped localStorage key, re-read on every mount, which is what makes "dismissed above a guide" also mean "dismissed on the context page".

**Enrollment therefore has one seam per surface**, each in the mount effect that already announces surface ownership: `ContextSidebar` in `src/module.tsx`, `FloatingPanelManager`, and `FullScreenPanel`. `enrollment-boundary.test.ts` pins that set from the other direction — nothing else may enroll. Note the consequence for the readout: **"enrolled" means "opened any Pathfinder surface", not "opened the sidebar"**, because all three can now show the banner.

The banner component itself never enrolls. It reads the memoised arm through `subscribeToEnrollment` + `useSyncExternalStore`, because enrolling from render would let a render React replays or abandons emit the exposure and write its dedupe marker for a banner nobody saw. The subscription earns its keep on floating and full-screen: the manager owns the seam, and child effects run before the parent's, so the banner renders `null` and then re-renders when `notifyEnrollment()` fires.

Enrollment also re-stamps the Faro session `experiments` attribute, because `initFaro` stamped it at boot before any arm was known. The enroller is the only point ordered after the arm resolves, so it owns the re-stamp — but it calls `notifyEnrollment()` from `experiments/enrollment-notifier.ts` rather than importing the stamper. `lib/telemetry/session` pulls in the Faro adapter statically, so importing it from the enroller would download the telemetry chunk even on stacks where `pathfinder.frontend-telemetry` is off; `module.tsx` binds the stamper from inside its telemetry block instead, and with that block skipped the notification is a no-op. Expect the session attribute to gain this cohort mid-session, on first panel open.

**Dismissal**: persisted per browser under `grafana-pathfinder-interactive-learning-banner-dismissed-{hostname}`. Dismissing hides the banner permanently but does **not** un-enroll the user — they stay in the treatment arm for analysis.

**Behavior events** (in addition to the exposure): `pathfinder_interactive_learning_banner_shown` (once per page load) and `pathfinder_interactive_learning_banner_dismissed`. Both carry `interaction_location: interactive_learning_banner` (context page) or `interactive_learning_banner_guide` (above a guide). Control renders nothing, so these events are treatment-only by construction — engagement comparisons must use guide-interaction events that carry the experiments enrichment, not these. See [EXPERIMENT_TESTING.md](./EXPERIMENT_TESTING.md#verifying-banner-analytics) for the readout contract.

**Code**: everything except the registry entry, the three enrollment seams, and the two banner mount lines lives in [`src/utils/experiments/interactive-learning-banner.ts`](../../src/utils/experiments/interactive-learning-banner.ts) and [`src/components/InteractiveLearningBanner/`](../../src/components/InteractiveLearningBanner/), so retiring the experiment is a directory delete plus the registry entry. [`enrollment-notifier.ts`](../../src/utils/experiments/enrollment-notifier.ts) is shared machinery and stays.

**Tracking key**: `interactive_learning_banner_experiment`

---

### `pathfinder.help-button-nudge-experiment`

Object flag, default `{ "variant": "excluded" }`. `control` leaves the toolbar unchanged.
`learn` inserts a separate **Learn** button (graduation cap and label, Grafana's theme-aware orange)
immediately before the unchanged question-mark Help button; it opens the interactive learning panel
with open source `help_button_learn`. Until its attention ends, the Learn button shows three small
twinkling sparkles (static for reduced motion, hidden in forced colors). `learn_hint` adds the
dismissible “Try interactive learning” hint below the Learn button.

The Learn button stays for the rest of the tab session once the tab is enrolled, including while the
panel is open and after a reload. Attention (sparkle and hint) ends for the tab on the first toolbar
click or when any route opens Pathfinder. Closing the hint, or pressing Escape while focus is on the
hint or its button, hides only the hint; the sparkle stays and a later toolbar click remains
attributable. State is scoped by namespace and signed-in user.

Enrollment happens only when the unique, visible question-mark Help button exposes
`aria-expanded="false"` while Pathfinder is closed; a tab that opens Pathfinder first is not enrolled. Mobile Help dropdowns, hidden tabs, ambiguous matches, anonymous sessions,
missing namespaces, disabled analytics, and unavailable Pathfinder Faro instances do not enroll.
The DOM adapter depends on Grafana's question-circle icon test ID, localized Help label (read from
core's `grafana` namespace), and expanded-state contract, and inserts the Learn button as a sibling in
Grafana's top bar; unsupported markup fails closed.

This experiment uses `@grafana-experiments/sdk@0.3.0` with Pathfinder's existing OpenFeature client
and isolated Faro instance. It deliberately has **no `trackingKey`**: the SDK owns the single
`experiment_viewed` denominator through `reportExperimentView` and Faro. Experiment ID:
`pathfinder-help-button-nudge-v1`; group: `closed-help-toolbar`. SDK exposure deduplication is per
Faro session and assignment, with sessionStorage persistence when available. Pathfinder's Faro
sessions are volatile, so a full reload can create a new session and exposure. Dismissal survives
reloads within the same tab. Do not interpret exposure rows as unique people or allocation units.

The primary outcome is `pathfinder_help_button_clicked_toolbar`, once per tab on the first toolbar
click before Pathfinder opens any other way, in all three arms. `toolbar_target` says which button:
`help` or `learn` (control can only report `help`). Later Learn opens are visible as
`docs_panel_interaction` opens with source `help_button_learn`. RudderStack properties include
`experiment_help_button_nudge`, `exposure_id`, `event_id`, and `toolbar_target`; Faro receives the SDK's full assignment snapshot. The SDK owns this event's Faro mirror,
so `reportAppInteraction` skips its normal mirror for this call. The closed-surface Faro gate admits
only this experiment's exposure, click, and hint dismissal; it does not activate replay or general page telemetry.

Remote provisioning is separate: create a public object flag with excluded/control/learn/learn_hint values,
excluded outside the chosen population, and the intended three-arm split inside it. Assignment uses
the existing stack/org OpenFeature context, never client-side user bucketing. Verify the deployed
bucketing field and allocation before declaring randomized inference. Keep the experiment's allocation
stable after launch; changing variation weights or ordering can change assignment boundaries.
The SDK accepts any caller-defined list of variation names; this integration declares these three.
Analysis is performed independently of Odin's two-arm analysis model. Verify ingestion for all arms
before launch. Hint dismissal emits `pathfinder_help_button_dismissed_hint` with the same attribution
properties as the click. A RudderStack dashboard needs staging models for these outcome events.

Retirement removes the flag registry entry, `help-button-attention/`, its bootstrap call, the shared
constants and dismissal key, the click event and mirror option (if unused elsewhere), the narrow
Faro filter exception and getter, the closed-surface experiment note in `TELEMETRY.md`, these documentation
sections, and the remote flag/experiment. If no other experiment uses it, also remove `@grafana-experiments/sdk`
and `src/lib/telemetry/experiments.ts`.

## Backend aggregation toggles (not MTFF)

Separate from the OpenFeature flags above, Grafana **App Platform APIService aggregation toggles** gate whether the plugin's aggregated backend APIs are served on a stack. They live in core Grafana config (`config.featureToggles`), not MTFF, and are read server-side in the Go backend — not through `openfeature.ts`.

| Toggle                                                  | Gates                                                                                                                                                | Go constant                                                                                                                                                          | Group         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `aggregation.pathfinderbackend-ext-grafana-app.enabled` | Every aggregated surface: the custom guide catalogue, the private `interactiveguides` resolver, and the completion-records read and write proxies    | `customGuideAggregationToggle` (`pkg/plugin/custom_guide_repository_client.go`) and `completionRecordsAggregationToggle` (`pkg/plugin/completion_records_client.go`) | GAP `.app`    |
| `aggregation.pathfinderbackend-ext-grafana-com.enabled` | Nothing today — completion records cut over to `.app` with no migration or dual-read, so the named constant only pins the `.app` derivation in tests | `pathfinderBackendAggregationToggle` (`pkg/plugin/app_platform_client.go`)                                                                                           | legacy `.com` |

The toggle name is the API group with dots replaced by dashes. The frontend derives the `.app` toggle in `src/utils/interactive-guides-api.ts`; the Go constants derive theirs from `appPlatformGroup` (`pkg/plugin/app_platform_client.go`) so they cannot drift from the group name.

A toggle reports that the group's aggregation layer is served, which is a **precondition, not the availability signal** — a real stack reports both toggles true. Route availability is whatever the capability/resolver path returns, which additionally requires an app URL, a namespace, and a provisioned on-behalf-of (OBO) token on the stack. See [`docs/design/BACKEND_PROXY_PATTERN.md`](../design/BACKEND_PROXY_PATTERN.md) §7–§8.

---

## How it works

### Architecture

The plugin connects to MTFF via the OFREP (OpenFeature Remote Evaluation Protocol) Web Provider:

```
Plugin (React)  -->  OpenFeature SDK  -->  OFREPWebProvider  -->  MTFF (/apis/features.grafana.app/...)
```

### Initialization

OpenFeature is initialized once at plugin load time in `src/module.tsx`:

```typescript
import { initializeOpenFeature } from './utils/openfeature';

await initializeOpenFeature();
```

This sets up the OFREP provider with the current namespace as targeting context:

```typescript
await OpenFeature.setProviderAndWait(
  OPENFEATURE_DOMAIN,
  new OFREPWebProvider({
    baseUrl: `/apis/features.grafana.app/v0alpha1/namespaces/${namespace}`,
    disableVisibilityRefresh: true, // Do not refresh
    cacheMode: 'disabled', // Do not write to localStorage
    timeoutMs: 10_000,
  }),
  {
    targetingKey: config.namespace,
    namespace: config.namespace,
    ...config.openFeatureContext,
  }
);
```

The domain `grafana-pathfinder-app` isolates this plugin's flags from Grafana core and other plugins.

### Evaluating flags

#### In React components (hooks)

Use the re-exported OpenFeature React hooks:

```typescript
import { useBooleanFlag } from '../../utils/openfeature';

const MyComponent = () => {
  const autoOpen = useBooleanFlag('pathfinder.auto-open-sidebar', false);
  // ...
};
```

Available hooks:

- `useBooleanFlag(flagName, defaultValue)` - For boolean flags
- `useStringFlag(flagName, defaultValue)` - For string flags
- `useNumberFlag(flagName, defaultValue)` - For number flags

These hooks must be used within an `OpenFeatureProvider` component tree.

#### In non-React code (synchronous)

Use `getFeatureFlagValue()` for boolean flags. Experiment flags are read through their own module under `src/utils/experiments/`, never directly, because the read is what enrolls a user.

```typescript
import { getFeatureFlagValue } from '../../utils/openfeature';

const shouldAutoOpen = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);
```

#### Async evaluation with guaranteed readiness

Use `evaluateFeatureFlag()` when you need to wait for the provider to be ready:

```typescript
import { evaluateFeatureFlag } from '../../utils/openfeature';

const autoOpen = await evaluateFeatureFlag('pathfinder.auto-open-sidebar');
```

### Exposure dedup

`pathfinder_feature_flag_evaluated` fires **once per (hostname, flag, variant) combination per browser**, persisted in localStorage under `grafana-pathfinder-experiment-exposure-reported-{hostname}:{flagKey}:{variant}`. Subsequent page loads where the user is still in the same arm produce zero events; variant reassignment (e.g. control → treatment) yields a new key and re-fires, which is what downstream A/B tools expect for fresh-arm exposures.

The hook keeps an in-memory `Set` as a fast path so the same flag never fires twice within a single page load, even when localStorage is unavailable.

### Analytics tracking

All flag evaluations are automatically tracked via `TrackingHook` (added during initialization). Flags with a `trackingKey` defined in `pathfinderFeatureFlags` are reported to analytics using that key.

## Adding a new feature flag

### 1. Define the flag

Add the flag to `pathfinderFeatureFlags` in `src/utils/openfeature.ts`:

```typescript
const pathfinderFeatureFlags = {
  // Existing flags...

  'pathfinder.my-new-feature': {
    valueType: 'boolean',
    values: [true, false],
    defaultValue: false,
    trackingKey: 'my_new_feature', // Optional: enables analytics tracking
  },
} as const satisfies Record<`pathfinder.${string}`, FeatureFlag>;
```

**Naming convention**: Use kebab-case format `pathfinder.<feature-name>`.

### 2. Use the flag

```typescript
// React component
import { useBooleanFlag } from '../../utils/openfeature';

const MyComponent = () => {
  const isEnabled = useBooleanFlag('pathfinder.my-new-feature', false);
  if (!isEnabled) return null;
  return <div>My feature content</div>;
};

// Non-React code
import { getFeatureFlagValue } from '../../utils/openfeature';
const isEnabled = getFeatureFlagValue('pathfinder.my-new-feature', false);
```

### 3. Register the flag in MTFF

Register the flag in the Multi-Tenant Feature Flag Service so it can be evaluated at runtime. This is managed through Grafana's internal MTFF configuration.

### 4. Document the flag

- Add to the "Current feature flags" section in this document
- Include purpose, type, default, behavior, and tracking key

## Testing

### Grafana Cloud

Feature flags are evaluated via MTFF. To test:

1. Register the flag in MTFF with appropriate targeting
2. Deploy the plugin
3. Verify in browser console:

```javascript
// View experiment config
window.__pathfinderExperiment;
```

### Local development (Grafana OSS)

MTFF is not available in OSS. Flags will use their default values. To test non-default states, you can:

1. Use the experiment debug utilities exposed on `window.__pathfinderExperiment`
2. Mock the OpenFeature provider in tests

### Testing both states

- **Default behavior**: Ensure the flag's default value produces correct behavior
- **Enabled/disabled**: Verify both flag states work correctly
- **Error handling**: Verify graceful fallback when evaluation fails (should return default value)

## Best practices

### 1. Default values

Always provide sensible defaults that maintain existing behavior if flag evaluation fails:

```typescript
// Good: Feature hidden by default if flag fails
const showNewFeature = useBooleanFlag('pathfinder.new-feature', false);

// Good: Maintain existing behavior if flag fails
const showExistingFeature = useBooleanFlag('pathfinder.existing-feature', true);
```

### 2. Flag naming

- Use descriptive kebab-case names: `pathfinder.auto-open-sidebar` not `pathfinder.feature1`
- Always prefix with `pathfinder.` to identify plugin-specific flags
- Use consistent naming for tracking keys (snake_case): `auto_open_sidebar`

### 3. Flag lifecycle

1. **Introduction**: Define flag with safe default, register in MTFF
2. **Validation**: Enable for testing, gather feedback, adjust targeting
3. **Stabilization**: Enable for all users once stable
4. **Cleanup**: Remove flag from code once feature is permanent

## Common issues

### Issue: Flag always returns default value

**Causes**:

1. `config.namespace` not available (prevents OpenFeature initialization)
2. MTFF not reachable (network/auth issue)
3. Flag not registered in MTFF
4. Flag name mismatch (check for typos)

**Solution**:

- Check browser console for `[OpenFeature]` warnings
- Verify initialization succeeded (no errors in console)
- Verify flag name matches MTFF registration exactly

### Issue: Flag not available in OSS

**Cause**: MTFF is a Grafana Cloud service. OSS instances cannot reach it.

**Solution**: This is expected. Flags will use their default values in OSS. Design defaults accordingly.

## References

- [OpenFeature specification](https://openfeature.dev/specification)
- [OpenFeature React SDK](https://openfeature.dev/docs/reference/technologies/client/web/)
- [OFREP Web Provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep-web)
- Source: `src/utils/openfeature.ts`
