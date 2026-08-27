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

Faro initializes only when `resolveFaroEnvironment()` resolves: Grafana Cloud with analytics enabled, on `.grafana.com` / `.grafana.net` / `.grafana-ops.net` / `.grafana-dev.net` hosts, and only when the default-on `pathfinder.frontend-telemetry` flag is set. Local development sends nothing unless `localStorage['pathfinder.faro.local'] = 'true'` in a dev build. The activity gate drops everything except errors until Pathfinder is opened, so collector sessions mean "used Pathfinder or Pathfinder errored", not "loaded a Grafana page".

Session replay adds a second remote switch (`pathfinder.session-replay`, also default-on) plus a volume dial (`pathfinder.session-replay-sampling-rate`, default `1`, range-checked at the point of use), but no new environment gate: it is registered from inside `initFaro`, after the `resolveFaroEnvironment()` early return, so a self-hosted or OSS Grafana never reaches it — such an instance does not construct a Faro instance in the first place, and the rrweb chunk is never fetched. The open that latches the activity gate is also what starts the recording, and once started it runs for the rest of the page, including after Pathfinder is closed again.

Two consequences of it being default-on. Recordings are only viewable on a stack where Grafana has switched on the private-preview feature. And Grafana core ships its own replay recorder behind `FlagKeys.FaroSessionReplay`: two rrweb instances on one page double DOM serialization per mutation and compound rrweb's global `CSSStyleSheet.insertRule` proxy, which is Emotion's hot path. `resolveSessionReplayOptions` in `telemetry/faro-adapter.ts` yields automatically when `config.featureToggles.faroSessionReplay` reads `true`, so the safe state does not depend on anyone remembering — but that toggle is private-preview and may never be surfaced to the frontend, in which case the read is `undefined` and the automatic guard does nothing. Still set `pathfinder.session-replay` false wherever core's flag goes true.

### Stopping a recording

**Both replay flags are read once, during plugin bootstrap.** OFREP visibility refresh is off, and the recorder has no removal path, so flipping either flag — or reverting the plugin — reaches a tab only on its next page load. A tab that was already recording keeps recording until it is closed or reloaded. Deliberate: re-evaluating the flag mid-session would mean either polling it or tearing the recorder down live, and a torn-down rrweb leaves a mutation stream with no snapshot to apply it to.

What that means operationally:

- **The kill switch is "no new recordings"**, not "recording stops now". Budget for the tail of long-lived tabs — a dashboard left open overnight is the worst case.
- **Recordings already ingested are not undone by the flip.** Removing them is a collector-side deletion request against the Frontend Observability app, not something a flag or a release can do.
- If a recording must stop immediately on a known stack, the only in-band lever is a plugin release plus a forced reload; otherwise the flag flip plus natural page turnover is the mechanism.
