# Telemetry: Faro and RudderStack

How Pathfinder ships frontend telemetry, what instrumentation a new feature gets for free, and when to add custom instrumentation. This doc backs the `/review` instrumentation coverage check and the `analytics-and-telemetry` concern in `docs/design/CONCERNS.md`.

## Two pipelines

| Pipeline                             | Purpose                                                  | Entry point                                       | Destination                                           |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| **RudderStack** (product analytics)  | What users do — funnels, adoption, experiments           | `reportAppInteraction()` (`src/lib/analytics.ts`) | Grafana's analytics warehouse via `reportInteraction` |
| **Faro** (operational observability) | Whether the plugin works — errors, latency, degradations | `src/lib/telemetry/` facade + adapter             | Frontend Observability (ops collector)                |

Both are Grafana-internal signals; neither is customer-visible. Every RudderStack event is mirrored into Faro (see below), so the two pipelines can be cross-checked against each other.

## Architecture

`src/lib/telemetry/` is layered; `src/lib/faro.ts` is a compatibility barrel over it.

- **Adapter** (`faro-adapter.ts`) — owns the SDK. Runs an isolated Faro instance (separate from Grafana core's), Cloud-only, volatile sessions. Every primitive is wrapped in `guardTelemetry`: telemetry must never break the app it observes.
- **Filtering** (`filtering.ts`) — `beforeSend` pipeline. Attribution whitelist (only Pathfinder stack frames, `[pathfinder]`-prefixed logs, resource timings to docs/recommender hosts) plus an activity gate (nothing except errors is sent until Pathfinder is actually open).
- **Typed facade** (`facade.ts` + `types.ts`) — domain operations (`recordContentFetch`, `recordRecommenderFallback`, …) over the `TELEMETRY_EVENTS` / `TELEMETRY_MEASUREMENTS` name registry. The registry is the schema surface: one reviewable file.
- **Bridge** (`bridge.ts`) — entry-eager modules (`analytics.ts`, `logging.ts`) reach Faro through a late-bound bridge so the SDK stays out of `module.js` (enforced by `entry-bundle-boundary.test.ts`).
- **Session replay** (`replay.ts` + `replay-scrub.ts`) — a masked rrweb recorder behind `pathfinder.session-replay`. Not part of the `instrumentations` array: it is added via `faro.instrumentations.add()` the first time Pathfinder is opened, because starting at page load would put rrweb's opening full-DOM snapshot on the wrong side of the activity gate and leave a stream of mutations with nothing to apply them to. Both the module and the instrumentation package are dynamically imported, so nothing loads when the flag is off.

Browser errors use `error` and `unhandledrejection` event listeners without replacing or calling Grafana's global handlers. Ambient errors require an absolute HTTP(S) URL with a Pathfinder asset path or the named Pathfinder `webpack:` source namespace. Dashboard query parameters, origin-less asset paths, empty-hostname `webpack:` URLs, and `webpack-internal:` frames do not establish ownership. Faro SDK wrapper sources are excluded only in `webpack:` frames; bundled HTTP(S) frames cannot distinguish SDK wrappers from other code in a plugin asset. Explicitly reported errors remain visible, including ResizeObserver errors attributable to Pathfinder.

Telemetry and completion-hook chunk imports retry `ChunkLoadError` failures up to three times, after 1, 5, and 30 seconds. An `online` event advances a pending retry. Other failures are not retried. Telemetry loading runs independently of plugin registration. While the completion hook loads, the recorder buffers up to 100 completions in memory for the current user and organization, then replays them into the durable queue. This volatile startup buffer extends the completion-records contract before durable queue acceptance. At capacity it drops the newest fact and logs a warning, whereas the durable queue evicts the oldest eligible record and reports degradation. A replay rejected by every listener leaves the fact eligible for a later completion event but removes it from the startup buffer. Resets discard buffered facts in the resetting tab only; a reset in another tab cannot clear this buffer, so recovery may queue a pre-reset completion. A reload before the hook accepts the facts also loses this temporary buffer.

## What a new feature gets for free

Four channels; three cost nothing beyond conventions the repo already follows:

| Channel               | Fires when                                                                      | Cost to a new feature                                           |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Auto-instrumentations | Unhandled errors, sessions, views, fetch timings to tracked hosts               | Zero — SDK-level                                                |
| Analytics mirror      | Every `reportAppInteraction()` call is mirrored into Faro as a user action      | Zero, if the feature adds product analytics (convention)        |
| Logger bridge         | Every `logger.info/warn/error` becomes a Faro log; throwables become exceptions | Zero, if the feature logs via `src/lib/logging.ts` (convention) |
| Custom facade ops     | Hand-written per operational funnel                                             | Deliberate work — see the decision rule                         |

So: a feature that reports its user-facing actions via `reportAppInteraction` and logs ordinary failures via `logger` is already observable. It does **not** need bespoke Faro design unless one of the decision-rule conditions below applies.

## Decision rule: when to add custom instrumentation

Add a typed facade op when the feature has any of:

1. **A fallback or degradation ladder** — a path where the app silently falls back to a lesser tier (e.g. content-fetch tiers, recommender fallback). Emit a `pushFaroEvent`-backed facade op so degradations are countable and alertable.
2. **A latency budget** — an async operation whose duration matters operationally (e.g. recommender round-trip, panel time-to-ready). Emit a `pushFaroMeasurement`-backed facade op with a namespaced value name (`*_ms`), never Faro's default web-vitals names.
3. **A critical multi-step operation** whose outcome should be stamped (ok/error/timeout) — wrap it in `withFaroUserAction` (e.g. guide open, sequence run).
4. **A new panel surface** with no URL to derive a view from — call `setFaroViewName` so sessions remain attributable to a view.

If none apply, the free channels cover you. When in doubt, ask: _if this silently degraded in production, would we see it?_ An error, stable logger signal, or analytics outcome is sufficient for an ordinary failure. Fallback ladders, latency budgets, critical multi-step operations, and no-URL panels still require the structured signals above.

## How to add a custom facade op

1. Add the event/measurement name to `TELEMETRY_EVENTS` or `TELEMETRY_MEASUREMENTS` in `src/lib/telemetry/types.ts` (`pathfinder_*` prefix).
2. Add a typed operation to `src/lib/telemetry/facade.ts` that encodes the attribute shape.
3. Call the operation from the feature. Never call `pushFaroEvent` / `pushFaroMeasurement` directly from product code — they are not exported from the compatibility barrel, and `src/lib/telemetry/facade-boundary.test.ts` reserves both names outside `src/lib/telemetry/`. The same test also forbids importing `faro-adapter` directly from outside `src/lib/telemetry/` (only `src/lib/faro.ts` may), so product code reaches adapter helpers through the compatibility barrel, never the adapter module.

Span helpers (`withFaroUserAction`, `setFaroUserActionAttributes`), explicit error pushes (`pushFaroError` from error boundaries), and view setters (`setFaroView`/`setFaroViewName`) may be used directly from components.

## Privacy invariants

Privacy protection is split between enforced normalization and caller discipline:

- **URLs** in structured `*_url` attributes go through `normalizeTelemetryUrl` (query/fragment stripped). Free-text log and exception values have embedded URL substrings normalized in `beforeSend`; other free text is preserved. `meta.page.url` goes through `redactPageUrl` on every item — see the page-URL bullet below for what that keeps and why.
- **Errors** in typed facade events use low-cardinality classifications such as `recordSequenceActionError`. `logger.error`, `logger.exception`, and direct `pushFaroError` calls retain the exception message, so callers must not include selectors, echoed input, or user-derived text.
- **Attributes** passed through `stringifyAttributes`—including event, user-action, and session attributes—are stringified and truncated to 500 characters. Measurement and exception contexts must use small, typed values at the call site.
- Never add high-cardinality or user-derived free-text attributes; new user-derived fields need privacy review (`analytics-and-telemetry` concern).
- **DOM capture** is a different privacy surface from the attribute rules above, and session replay is the only thing that does it. rrweb records the whole page, Grafana core included; there is no subtree scoping, and no way to unmask a carve-out (`maskTextSelector` resolves through `closest()`, and this rrweb fork has no `unmaskTextSelector`). What that buys and what it does not:
  - **Covered by the SDK**: every text node is masked, every input type is masked, and canvas, fonts, inline images, inline stylesheets and cross-origin iframes are all off. The Coda terminal is blocked outright — it is the one surface that renders credentials verbatim.
  - **Not covered by the SDK**: rrweb never masks DOM attributes, and Grafana puts real content in them (`data-testid="Panel header <panel title>"`, `aria-label`, `title`, `alt`, `placeholder`). URLs, including dashboard `var-*` query parameters, are recorded whole. Neither does it mask CSS: `<style>` text, `_cssText`, inserted rules and CSSOM writes are all exempt, because masking them would strip the replay of styling.
  - **Closed by `replay-scrub.ts`**: an attribute allowlist — rendering-affecting and enumerated-value attributes survive, URL attributes go through `stripUrlSecrets`, and everything else is dropped. It is an allowlist rather than a denylist because with all text already masked, an unrecognized attribute is pure downside. Adding to `SAFE_ATTRIBUTES` means asserting the attribute cannot carry user-authored text.
  - **Also closed by `replay-scrub.ts`**: the CSS channel, on both counts. Resource references (`url()`, `@import`, `image-set()`) go through `stripUrlSecrets`; the two declarations that can put author text on screen — `content` and custom properties — have their string literals masked, escape sequences kept so icon glyphs still render. A value containing a resource function is left to the URL pass rather than masked twice. The residual is cosmetic: a stack whose theme puts a quoted string in a custom property (a font stack, say) plays back with that value asterisked.
- **Page URLs are deliberately kept, minus their query.** This is the one place the "all text is masked" line does not hold, so it is worth stating plainly rather than leaving as a gap:
  - The **path is recorded whole**, dashboard title slug included — `/d/<uid>/acme-q3-revenue`. That is a considered trade: it is what makes a replay navigable, and the board name is not a secret to anyone who can already read this telemetry. The masking guarantee covers rendered text and DOM attributes; page URLs are outside it.
  - The **query is stripped**, everywhere. On a Grafana URL the query is where the user's own choices live — `var-*` template values, Explore's serialized queries, `?doc=` deep links — which is a different class of data from a title.
  - This applies on **two independent channels**. `replay-scrub.ts` covers URLs inside the rrweb payload; `redactPageUrl` in `filtering.ts` covers `meta.page.url`, which Faro sets from `location.href` on every item regardless of payload. The second one matters more than it looks: Grafana Cloud's collector explodes that query into `page.attributes`, so an unscrubbed URL arrives as first-class searchable `page_attr_var_*` fields.

## Gating and environments

Faro initializes only when `resolveFaroEnvironment()` resolves: Grafana Cloud with analytics enabled, on `.grafana.com` / `.grafana.net` / `.grafana-ops.net` / `.grafana-dev.net` hosts, and only when the default-on `pathfinder.frontend-telemetry` flag is set. Local development sends nothing unless `localStorage['pathfinder.faro.local'] = 'true'` in a dev build. The activity gate drops everything except errors until a Pathfinder surface reports itself on mount — a persisted panel mode alone no longer opens it — so collector sessions mean "used Pathfinder or Pathfinder errored", not "loaded a Grafana page".

Session replay adds a second remote switch (`pathfinder.session-replay`, also default-on) plus a volume dial (`pathfinder.session-replay-sampling-rate`, default `1`, range-checked at the point of use), but no new environment gate: it is registered from inside `initFaro`, after the `resolveFaroEnvironment()` early return, so a self-hosted or OSS Grafana never reaches it — such an instance does not construct a Faro instance in the first place, and the rrweb chunk is never fetched. The first Pathfinder surface open latches the activity gate and starts recording; closing the panel pauses recording after five seconds, while reopening resumes it immediately.

Two consequences of it being default-on. Recordings are only viewable on a stack where Grafana has switched on the private-preview feature. And Grafana core ships its own replay recorder behind `FlagKeys.FaroSessionReplay`: two rrweb instances on one page double DOM serialization per mutation and compound rrweb's global `CSSStyleSheet.insertRule` proxy, which is Emotion's hot path. `resolveSessionReplayOptions` in `telemetry/faro-adapter.ts` yields automatically when `config.featureToggles.faroSessionReplay` reads `true`, so the safe state does not depend on anyone remembering — but that toggle is private-preview and may never be surfaced to the frontend, in which case the read is `undefined` and the automatic guard does nothing. Still set `pathfinder.session-replay` false wherever core's flag goes true.

### Stopping a recording

**Both replay flags are read once, during plugin bootstrap.** OFREP visibility refresh is off, and the recorder is never removed from the Faro instance, so flipping either flag — or reverting the plugin — reaches a tab only on its next page load. Deliberate: re-evaluating a flag mid-session would mean polling it, and neither flag is worth a poll.

The recorder does stop and start within a session, but on the surface lifecycle rather than on the flags. Closing the last Pathfinder surface pauses recording five seconds later, and reopening resumes it immediately. A pause stops rrweb outright and the resume emits a fresh full-DOM snapshot, so each open yields a playable clip rather than orphaned mutations. `inactivityThresholdMs` is deliberately `0`, which turns the SDK's own idle auto-pause off: its paired auto-resume rebinds document-wide interaction listeners and would restart recording on the first mouse move while Pathfinder was closed. Surface state is the sole pause authority — which also means an open panel on an idle tab keeps recording where the SDK default would have paused it after 60 seconds.

What that means operationally:

- **The kill switch is "no new recordings"**, not "recording stops now". Budget for the tail of long-lived tabs, now bounded by Pathfinder use rather than tab lifetime: a tab with no surface open stops five seconds after the last close, so the worst case is a docked sidebar left open on an auto-refreshing dashboard overnight.
- **Recordings already ingested are not undone by the flip.** Removing them is a collector-side deletion request against the Frontend Observability app, not something a flag or a release can do.
- If a recording must stop immediately on a known stack, the only in-band lever is a plugin release plus a forced reload; otherwise the flag flip plus natural page turnover is the mechanism.

## Investigating guide loading and rendering

A guide open carries an in-memory `load_id` from launch preparation through content fetching and the renderer. A successful `pathfinder_content_fetch` measurement means that content was fetched and shaped; it does not prove the guide appeared. Use `pathfinder_guide_render` for the final visible outcome. The mirrored `open_guide` action now finishes with this outcome on instrumented launches (`phase=render`); its `duration_ms` records active loading time.

| Signal                                          | What it explains                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pathfinder_guide_request`                      | Each HTTP attempt: source, file role, duration, HTTP status, and transport reason. Attempts in a fallback ladder share a load ID.                                                                                                   |
| `pathfinder_guide_render`                       | `rendered`, `error`, `timeout`, or `cancelled` terminal outcome. `awaiting-user` and `degraded` are intermediate states, not failed opens.                                                                                          |
| `pathfinder_content_fetch`                      | Existing latency measurement, enriched with load ID and structured failure diagnostics.                                                                                                                                             |
| `pathfinder_content_fetch_fallback`             | Existing fallback event, correlated with the load ID when supplied.                                                                                                                                                                 |
| `pathfinder_package_index`                      | Index availability, backend cache disposition/age, manifest failure counts by HTTP/timeout/JSON/other reason, enrichment-budget exhaustion, and suppressed session retries.                                                         |
| `pathfinder_custom_guide_catalogue_unavailable` | Existing private-catalogue signal, now preserving bounded transient proxy reasons and upstream status.                                                                                                                              |
| `pathfinder_assignments_unavailable`            | Assignment listing could not be read, with a bounded reason (server-reported capability reason, `malformed-response`, or a classified request failure such as `http-503` or `http-429`). The panel keeps the last good assignments. |
| `pathfinder_assignment_target_unresolved`       | Count of assigned path targets found in neither the local catalogue nor the online catalogue. Target ids are not attributes.                                                                                                        |

Failure diagnostics contain `source`, `stage`, `reason`, optional `http_status`, and `validation_count`. Stages distinguish resolution, fetching, JSON decoding, schema validation, launch preparation, and rendering. A browser network failure is classified as `network-error`, without guessing whether CORS caused it. When every package resolver fails, the first diagnostic other than a routine lookup miss takes precedence; if every attempt misses, the first lookup diagnostic is retained. Later fallback misses do not replace an earlier index, content, or permission failure. This diagnostic selection does not change resolver order, returned error codes, or cache behavior. Native guide JSON that cannot be parsed is rejected; deliberate HTML documents and supported missing/null JSON fallbacks remain supported.

A load has one terminal outcome. Closing or replacing its tab cancels it, hidden content pauses its budget, and alignment prompts pause the 60-second active-time budget until the learner responds. Render success is emitted from the committed valid content tree after snippet resolution, not from a readiness timer. Partial parser/snippet failures produce degradation signals; a later React crash after initial success is also a degradation rather than a second terminal outcome. Requests correlated to an explicitly initiated guide load, along with render errors and timeouts, pass the activity gate before a destination mounts. Uncorrelated requests and unrelated events remain gated; consent and environment gates still apply.

Private guides use random opaque references held only in memory. Private resource names, namespaces, titles, content, raw validation messages, and upstream response bodies are not diagnostic attributes. Existing private-guide URL/view attributes are anonymized, and private guide actions omit authored metadata from the Faro mirror. Public content URLs retain only normalized hostname/path. No load state is written to tab storage. These changes do not redact historical telemetry.

The optional `diagnostics` object on `/package-recommendations` reports `outcome`, bounded `reason`, `upstreamStatus`, `cache` (`hit`, `shared`, or `refresh`), `cacheAgeMs`, `manifestFailures` counts by reason, and `budgetExhausted`. Error responses retain `package-index-unavailable` and HTTP 503. Transient `/custom-guide-repository` responses retain their error identifier, HTTP 503, and Retry-After header and add the same safe diagnostic shape. Cache diagnostics contain no user data; cache lifetimes and retry policies are unchanged. Older clients ignore these additions and newer clients tolerate missing diagnostics.

In the ops Loki datasource, use the application's `app_id` label and parse the Faro logfmt fields. For example:

```logql
{app_id="77"} | logfmt | event_name="pathfinder_guide_render" | event_data_outcome=~"error|timeout"
```

Once a failing event provides a load ID, inspect its request attempts and outcome together:

```logql
{app_id="77"} | logfmt | event_data_load_id="<load ID>"
```

Inspect CDN index degradation independently of guide-not-found outcomes:

```logql
{app_id="77"} | logfmt | event_name="pathfinder_package_index" | event_data_outcome=~"error|degraded|suppressed"
```

Private guide content and settings reads use the plugin backend OBO proxy. The plugin backend also owns the private catalogue, completion and public CDN index proxies. Adding instrumentation to the local Go handlers in `grafana-pathfinder-backend` does not add production reporting: that repository currently deploys the CRD manifest only.

### App Platform proxy failures

The frontend Faro event `pathfinder_proxy_failure` records sanitized optional proxy diagnostics: `stage`,
`resource`, `operation`, `reason`, `upstream_status`, `outcome`, and `cache`.
The browser parser allowlists these fields; raw errors, guide names, user identities,
credentials and upstream response bodies are not event attributes. Faro app metadata
supplies the plugin version. Older backend responses without diagnostics remain valid.
`pathfinder_settings_store_resolved` remains the complementary settings outcome signal.

Backend `event=pathfinder_proxy_failure` logs contain `stack_namespace` (the trusted
plugin-context namespace), `resource`, `operation`, `stage`, `reason`, and
`upstream_status`. Unexpected errors also carry `error_type`, the Go type of the
unwrapped error, never its message. `outcome` and `cache` belong to the response/Faro
envelope, not this per-operation log. Grafana supplies plugin version and trace context.
These backend logs are the primary alert source, so browser
initialization and Faro activity gating are not detection prerequisites. A silent period
is not recovery proof; verify successful endpoint/user flows. Frontend degraded rendering
and upstream service recovery are separate observations.

## Step events and percentages

The interactive step events — `show_me_button_click`, `do_it_button_click`, `step_auto_completed`, `step_auto_complete_failed`, `step_skipped`, the blocking data check's `data_check_*` events and `gcx_setup_skipped` — all build their properties through `buildInteractiveStepProperties` in `src/lib/analytics.ts`. They share `source_document`, `step_id`, `current_step`, `total_document_steps`, `completion_percentage`, `section_id` and `section_title`, and join on `source_document` + `step_id`.

### What the step fields mean

- **`completion_percentage` is a step position, not progress.** It is `round(100 × current_step / total_document_steps)`, where `total_document_steps` is the number of tracked steps the section registry counted in the rendered document. The formula has not changed since it was introduced (#202, October 2025), so the series is comparable across versions — but it is never the percentage the app shows. `do_section_button_click` and the events built with `enrichWithStepContext` (links opened from a guide, `reset_progress_click`) carry the same step-position figure.
- **`completion_method`** is the constant `auto_detected` on `step_auto_completed` and is absent on quiz rows, so it says nothing about how a step was completed. Terminal `do_it_button_click` rows carry `copy` or `exec`.
- **`step_auto_completed` covers auto-detected completions and quiz answers only.** A guided step emits one per sub-action the reader performs (`internal_step_number` of `internal_actions_count`), so only the row where the two are equal means the block finished. A multistep emits once, when its last action is detected. A quiz emits on a correct answer and also on a max-attempts reveal, with `quiz_is_correct` false and `quiz_revealed` true.
- **A successful Do it on a plain step emits `do_it_button_click` only**, at click time and before the action runs, so the row does not say whether the action succeeded. No completion event follows.
- **Some completions send no completion event**: a Do section run (only `do_section_button_click`), Show me on a step that has no Do it (only `show_me_button_click`, sent at click time), a step whose objectives were already met, and "Mark section as complete".

### Block properties

When the guide has a frozen block index (`getGuideIndex` in `src/global-state/active-guide-index.ts`, published for JSON guides only), step events also carry:

| Property                  | Meaning                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block_position`          | The counted position the completion store credits when this step completes. It is computed by the same arithmetic (`furthestEvidencedPosition` over one "Do it" signal), so a step inside a conditional branch reports its conditional's position. |
| `total_block_count`       | The guide percentage's denominator: counted blocks, containers excluded.                                                                                                                                                                           |
| `completable_block_count` | Counted blocks that can emit completion evidence.                                                                                                                                                                                                  |
| `section_count`           | Section containers in the guide — the index's `sectionCount`, the same figure as the manifest stamp's `sectionCount` and the library survey in `docs/design/COMPLETION-MODEL.md`. A section with no counted blocks cannot move the percentage.     |

All four are omitted when there is no index for the content key (HTML docs never have one) or the step has no position (an anonymous standalone step, or a block whose runtime id a `snippet-ref` shifts). The index is looked up under `getContentKey()`, the key the completion store credits steps under; `source_document` is the same value before that key's sanitization. `mark_complete_clicked` carries `total_block_count`, `completable_block_count` and `section_count` under the same index rule. It also carries `guide_id`, `guide_source` and `guide_visibility` using the terminal-completion identity and privacy helper: public guides and milestones have their canonical guide id; App Platform, remote and unresolved sources omit the id. The click never sends a title or containing path id. A milestone uses its own slug, not the parent manifest id. The click also carries `content_type` (`interactive-guide`, `learning-journey` or `docs`), and on a milestone the reader's `current_milestone` and the path's `total_milestones`.

### Measuring guide progress

`block_progress_rule_version: block-position-v1` names the formula for the new block properties; `guide_stats_version` identifies the counting rules used by the live index. Step events retain the legacy step-position `completion_percentage`, tagged `percentage_rule_version: step-position-v1`. The footer's live `completion_percentage_before` is tagged `percentage_rule_version: block-position-v1`. These markers do not reclassify stored percentages in older events.

The step stream cannot reconstruct exact guide progress. `do_it_button_click` fires before execution and may fail; Do section, Show me-only steps, already-satisfied objectives and section acknowledgements do not all emit completion signals. A maximum over click positions can therefore both over-credit and under-credit. Use `completion_percentage_before` as a live observation at mark time and terminal completion events as terminal observations. An authoritative incremental-progress event from the shared completion store, including reset and restoration semantics, remains a separate follow-up.

**Binary-only guides** are those with `completable_block_count` 0 and `section_count` 0. Nothing but Mark complete can evidence them, so they read 0% or 100% and nothing in between. In the completion model's survey that is 256 of the 308 guides with no completable block; the other 52 have sections, and "Mark section as complete" gives them intermediate percentages.

### Skips

`step_skipped` is emitted once per skip, from the click that performs it, by every Skip control and once for each step a Do section run skips. It carries the step properties above, so it joins `step_auto_completed` on `source_document` + `step_id`, plus `target_action` (the step type: the interactive action such as `button`, or `multistep`, `guided`, `quiz`, `challenge`, `code-block`, `terminal`, `terminal-connect`, `datasource-check`, `input`), `interaction_location` and `skip_reason`:

| `skip_reason`        | Produced by                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`               | A Skip on a step that could still be done: the always-available Skip on plain, multistep, guided and quiz steps, a cancelled guided tour, a challenge or data check not yet failed, gcx setup before any attempt, and input blocks.      |
| `requirements_unmet` | A Skip offered because the step cannot be done here: failed requirements (plain, code block, terminal, data check), an unavailable Coda sandbox (terminal), or no data source of the authored type.                                      |
| `after_failure`      | A Skip after the step was tried and failed: multistep and guided execution errors and timeouts, a failed challenge check or setup, a data check that found no data or errored, and gcx setup that failed or fell back to a pasted token. |
| `section_run_auto`   | A Do section run skipping a skippable step whose requirements failed and could not be fixed.                                                                                                                                             |

A skipped step credits the guide percentage like a completed one. It is evidence of progress, but does not make the incomplete stream an exact progress ledger. Input blocks are the exception: they have no step id (`step_id` is `unknown`) and record nothing. `data_check_skipped` and `gcx_setup_skipped` still fire as before, gaining only the block properties every step event carries; each skip that sends one also sends `step_skipped`. Block-editor previews are not filtered out, as with every other step event.

### Percentage properties by plugin version

Live values are computed when the event fires. Stored values are read back from browser storage, so the rule that produced them depends on when the value was written, not on the row's `plugin_version`.

| Property                                                                          | Events                                                                 | Source            | Cutovers                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completion_percentage`                                                           | Step events, `do_section_button_click`, `enrichWithStepContext` events | Live              | Step position in every version.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `block_position`, `total_block_count`, `completable_block_count`, `section_count` | Step events; the three counts on `mark_complete_clicked`               | Live              | Absent before the first release after 2.20.1.                                                                                                                                                                                                                                                                                                                                                                                       |
| `completion_percentage_before`                                                    | `mark_complete_clicked`                                                | Live              | Block rule since the event shipped in 2.18.0; conditional-branch steps credited from 2.18.2.                                                                                                                                                                                                                                                                                                                                        |
| `completion_percentage`                                                           | `open_resource_click` (featured cards and recommendations)             | Stored            | Before 2.18.0: completed steps / total document steps. 2.18.0 (#1866): block rule — furthest evidenced position / `total_block_count`, capped at 99 until complete, Mark complete = 100 — for values written from then on; #1864 dropped v2.17-shaped evidence, so values stored by older versions never heal on reopen. 2.18.2 (#1953): conditional-branch credit. 2.19.0 (#1925): legacy milestone completions backfilled as 100. |
| `completion_percent`                                                              | `learning_path_progress`                                               | Stored, rolled up | Before 2.18.0: completed guides / total guides. From 2.18.0 (#1866): the mean of the members' stored percentages, with the per-guide cutovers above. Only guide-list paths send this event and they have one sequence, so #1927's best-of-sequence rollup (2.19.0) does not change these rows.                                                                                                                                      |
| `completion_percentage`                                                           | `milestone_arrow_interaction_click`, `close_tab_click` (journeys)      | Stored, averaged  | Before 2.18.0: the navigation ordinal (current milestone over total). From 2.18.0: the mean of the members' evidence percentages, with the per-guide cutovers above. From 2.20.0 (#2033), toolbar-arrow rows average the reader's active track when they have one.                                                                                                                                                                  |

## Kiosk catalogs and launches

`pathfinder_kiosk_catalog_loaded` records the served `tier` (`override`, `configured`, `generic`, or `bundled`) and whether loading `degraded`. An unconfigured kiosk serves bundled rules without degradation. Cancelled loads emit no outcome. Catalog failure logs contain only the tier and a bounded reason; rejected rule logs name the invalid field without its value.

`KioskDemoStarted` includes `launch_mode` (`instance` or `presentation`). Since URL-selected kiosks were added, `target_instance` is the current origin for instance launches and the catalog target (or current origin) for presentation launches. Filter by `launch_mode = presentation` for booth-demo comparisons; older events lack this field. Catalog URLs, rule content, and raw failure messages are not added to catalog telemetry.

Structured kiosk controls emit `kiosk_interaction`, mirrored to Faro through the normal analytics bridge:

| Component     | Actions                                                                   | Extra fields                                                           |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `input`       | `change` once per field per mounted form; `invalid` for native validation | `input_type`, zero-based `input_index`                                 |
| `launch-form` | `submit`, `ready`, `error`                                                | Errors use bounded `reason`: `validation`, `storage`, or `unavailable` |
| `command`     | `copy`                                                                    | `outcome`: `success` or `error`                                        |

Explicit exits emit the same event with `component=kiosk`, `action=exit`, and `method=button` or `escape`. Launching a guide is not counted as an exit, and dismissing a child dropdown is not counted either.

All carry `launch_mode`; page controls also carry zero-based `block_index`. `fallback` means the guide opened without transferring inputs because its declarations or variable usage were incompatible. This is silent for visitors. `ready` means destination validation and input persistence succeeded; it does not assert that the guide rendered. Existing `KioskDemoStarted` and guide-render telemetry cover the subsequent launch. Alternative cards and links use that same launch event. Input engagement is measured on the first change, not focus or each keystroke. Unmounted/aborted forms do not emit a terminal outcome.

These events deliberately omit values, selected data source names, variable names, prompts, command text, catalog URLs, and raw exceptions. They use the existing consent gates and analytics-to-Faro bridge; they do not introduce another telemetry client.

Kiosk input launch failures log a bounded stage and reason through the shared logger (console and Faro), for example `destination/input-format-mismatch`. Diagnostics exclude submitted values, guide URLs, authored text, and raw exceptions. Ordinary input validation errors are not operational error logs.

Startup settings decisions record a `pathfinder_startup_settings` measurement with
`startup_settings_ms` and a closed `outcome` value (`resolved`, `read-error`,
`timeout`, or `remote-disabled`). Reporting waits for Faro initialization and the
first Pathfinder surface open, preserving the activity boundary. This measures
opened sessions, not all Grafana page loads; it cannot establish fleet-wide
opt-out coverage. The local startup diagnostic also reports duration and outcome
without settings, user IDs, or stack IDs.

## Assistant customization

`assistant_customize_click`, `assistant_customize_success` and `assistant_customize_error` cover both inline block customization and whole-guide customization. Whole-guide runs carry the fixed `source: private-guide` attribute; filter by this attribute when measuring them separately from inline block runs. Inline block events retain their existing `source_document`, `step_id`, `assistant_id`, `assistant_type` and `content_key` attributes.

Whole-guide clicks are recorded before context collection and prompt serialization, so local validation failures have a matching attempt. Success means a generated guide passed validation and was offered for editor review; it does not mean the user saved or published it. A repair attempt belongs to the original click. These events contain no answers, guide content, data-source metadata or generated output.
