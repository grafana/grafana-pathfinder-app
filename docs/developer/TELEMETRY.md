# Telemetry: Faro and RudderStack

How Pathfinder ships frontend telemetry, what instrumentation a new feature gets for free, and when to add custom instrumentation. This doc backs the `/review` instrumentation coverage check and the `analytics-and-telemetry` concern in `docs/design/CONCERNS.md`.

## Two pipelines

| Pipeline                             | Purpose                                                  | Entry point                                   | Destination                                           |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| **RudderStack** (product analytics)  | What users do — funnels, adoption, experiments           | `reportAppInteraction()` (`lib/analytics.ts`) | Grafana's analytics warehouse via `reportInteraction` |
| **Faro** (operational observability) | Whether the plugin works — errors, latency, degradations | `src/lib/telemetry/` facade + adapter         | Frontend Observability (ops collector)                |

Both are Grafana-internal signals; neither is customer-visible. Every RudderStack event is mirrored into Faro (see below), so the two pipelines can be cross-checked against each other.

## Architecture

`src/lib/telemetry/` is layered; `src/lib/faro.ts` is a compatibility barrel over it.

- **Adapter** (`faro-adapter.ts`) — owns the SDK. Runs an isolated Faro instance (separate from Grafana core's), Cloud-only, volatile sessions. Every primitive is wrapped in `guardTelemetry`: telemetry must never break the app it observes.
- **Filtering** (`filtering.ts`) — `beforeSend` pipeline. Attribution whitelist (only Pathfinder stack frames, `[pathfinder]`-prefixed logs, resource timings to docs/recommender hosts) plus an activity gate (nothing except errors is sent until Pathfinder is actually open).
- **Typed facade** (`facade.ts` + `types.ts`) — domain operations (`recordContentFetch`, `recordRecommenderFallback`, …) over the `TELEMETRY_EVENTS` / `TELEMETRY_MEASUREMENTS` name registry. The registry is the schema surface: one reviewable file.
- **Bridge** (`bridge.ts`) — entry-eager modules (`analytics.ts`, `logging.ts`) reach Faro through a late-bound bridge so the SDK stays out of `module.js` (enforced by `entry-bundle-boundary.test.ts`).

## What a new feature gets for free

Four channels; three cost nothing beyond conventions the repo already follows:

| Channel               | Fires when                                                                      | Cost to a new feature                                       |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Auto-instrumentations | Unhandled errors, sessions, views, fetch timings to tracked hosts               | Zero — SDK-level                                            |
| Analytics mirror      | Every `reportAppInteraction()` call is mirrored into Faro as a user action      | Zero, if the feature adds product analytics (convention)    |
| Logger bridge         | Every `logger.info/warn/error` becomes a Faro log; throwables become exceptions | Zero, if the feature logs via `lib/logging.ts` (convention) |
| Custom facade ops     | Hand-written per operational funnel                                             | Deliberate work — see the decision rule                     |

So: a feature that reports its user-facing actions via `reportAppInteraction` and logs its failures via `logger` is already observable. It does **not** need bespoke Faro design.

## Decision rule: when to add custom instrumentation

Add a typed facade op when the feature has any of:

1. **A fallback or degradation ladder** — a path where the app silently falls back to a lesser tier (e.g. content-fetch tiers, recommender fallback). Emit a `pushFaroEvent`-backed facade op so degradations are countable and alertable.
2. **A latency budget** — an async operation whose duration matters operationally (e.g. recommender round-trip, panel time-to-ready). Emit a `pushFaroMeasurement`-backed facade op with a namespaced value name (`*_ms`), never Faro's default web-vitals names.
3. **A critical multi-step operation** whose outcome should be stamped (ok/error/timeout) — wrap it in `withFaroUserAction` (e.g. guide open, sequence run).
4. **A new panel surface** with no URL to derive a view from — call `setFaroViewName` so sessions remain attributable to a view.

If none apply, the free channels cover you. When in doubt, ask: _if this silently degraded in production, would we see it?_ If yes (an error is thrown, a `logger.error` fires, or an analytics event captures the outcome), you're done.

## How to add a custom facade op

1. Add the event/measurement name to `TELEMETRY_EVENTS` or `TELEMETRY_MEASUREMENTS` in `src/lib/telemetry/types.ts` (`pathfinder_*` prefix).
2. Add a typed operation to `src/lib/telemetry/facade.ts` that encodes the attribute shape.
3. Call the operation from the feature. Never call `pushFaroEvent` / `pushFaroMeasurement` directly from product code — `src/lib/telemetry/facade-boundary.test.ts` enforces this so every name stays in the registry.

Span helpers (`withFaroUserAction`, `setFaroUserActionAttributes`), explicit error pushes (`pushFaroError` from error boundaries), and view setters (`setFaroView`/`setFaroViewName`) may be used directly from components.

## Privacy invariants

These live in the adapter/facade so call sites can't leak, but new attributes still need judgment:

- **URLs** go through `normalizeTelemetryUrl` (query/fragment stripped). The analytics mirror normalizes any `*_url`-named property; free-text log/exception content has embedded URLs redacted in `beforeSend`.
- **Errors** are reported as low-cardinality classifications, never raw messages — free-text error strings embed URLs, selectors, and echoed input (see `recordSequenceActionError`).
- **Attributes** are stringified and truncated to 500 chars.
- Never add high-cardinality or user-derived free-text attributes; new user-derived fields need privacy review (`analytics-and-telemetry` concern).

## Gating and environments

Faro initializes only when `resolveFaroEnvironment()` resolves: Grafana Cloud with analytics enabled, on `.grafana.net` / `.grafana-ops.net` / `.grafana-dev.net` hosts. Local development sends nothing unless `localStorage['pathfinder.faro.local'] = 'true'` in a dev build. The activity gate drops everything except errors until Pathfinder is opened, so collector sessions mean "used Pathfinder or Pathfinder errored", not "loaded a Grafana page".
