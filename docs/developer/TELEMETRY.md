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

- **URLs** in structured `*_url` attributes go through `normalizeTelemetryUrl` (query/fragment stripped). Free-text log and exception values have embedded URL substrings normalized in `beforeSend`; other free text is preserved.
- **Errors** in typed facade events use low-cardinality classifications such as `recordSequenceActionError`. `logger.error`, `logger.exception`, and direct `pushFaroError` calls retain the exception message, so callers must not include selectors, echoed input, or user-derived text.
- **Attributes** passed through `stringifyAttributes`—including event, user-action, and session attributes—are stringified and truncated to 500 characters. Measurement and exception contexts must use small, typed values at the call site.
- Never add high-cardinality or user-derived free-text attributes; new user-derived fields need privacy review (`analytics-and-telemetry` concern).

## Gating and environments

Faro initializes only when `resolveFaroEnvironment()` resolves: Grafana Cloud with analytics enabled, on `.grafana.com` / `.grafana.net` / `.grafana-ops.net` / `.grafana-dev.net` hosts. Local development sends nothing unless `localStorage['pathfinder.faro.local'] = 'true'` in a dev build. The activity gate drops everything except errors until Pathfinder is opened, so collector sessions mean "used Pathfinder or Pathfinder errored", not "loaded a Grafana page".
