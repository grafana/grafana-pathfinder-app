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

- **URLs** in structured `*_url` attributes go through `normalizeTelemetryUrl` (query/fragment stripped). Free-text log and exception values have embedded URL substrings normalized in `beforeSend`; other free text is preserved. `meta.page.url` goes through `redactPageUrl` on every item — see the page-URL bullet below for what that keeps and why.
- **Errors** in typed facade events use low-cardinality classifications such as `recordSequenceActionError`. `logger.error`, `logger.exception`, and direct `pushFaroError` calls retain the exception message, so callers must not include selectors, echoed input, or user-derived text.
- **Attributes** passed through `stringifyAttributes`—including event, user-action, and session attributes—are stringified and truncated to 500 characters. Measurement and exception contexts must use small, typed values at the call site.
- Never add high-cardinality or user-derived free-text attributes; new user-derived fields need privacy review (`analytics-and-telemetry` concern).
- **No telemetry DOM capture**: Pathfinder does not record session replay. Grafana core owns any replay capture and its privacy configuration; the plugin's telemetry filters do not apply to core's stream.
- **Page URLs retain their path**, including dashboard title slugs. `redactPageUrl` in `filtering.ts` strips query strings, fragments, and credentials from `meta.page.url` and redacts public-dashboard access tokens and snapshot keys in paths. Query values such as dashboard `var-*` filters, Explore queries, and `?doc=` deep links must not become searchable collector attributes.

## Gating and environments

Faro initializes only when `resolveFaroEnvironment()` resolves: Grafana Cloud with analytics enabled, on `.grafana.com` / `.grafana.net` / `.grafana-ops.net` / `.grafana-dev.net` hosts, and only when the default-on `pathfinder.frontend-telemetry` flag is set. Local development sends nothing unless `localStorage['pathfinder.faro.local'] = 'true'` in a dev build. The activity gate drops everything except errors until a Pathfinder surface reports itself on mount — a persisted panel mode alone no longer opens it — so collector sessions mean "used Pathfinder or Pathfinder errored", not "loaded a Grafana page".

## Session replay ownership

**Pathfinder does not capture session replay.** Grafana core is the sole owner of `ReplayInstrumentation`. Multiple Faro SDK recorders on one page can corrupt recordings ([faro-web-sdk#2298](https://github.com/grafana/faro-web-sdk/issues/2298)), so the plugin must not install a second recorder, even when core replay appears disabled.

Replay enablement, sampling, and privacy configuration belong to Grafana core and the stack owners, not Pathfinder feature flags or surface lifecycle. Stack owners must enable core replay as needed; a Frontend Observability app link does not imply replay is enabled, including in production.

Use the Grafana core Frontend Observability apps for replay investigations:

- [Dev](https://dev.grafana-dev.net/a/grafana-kowalski-app/apps/164)
- [Ops](https://ops.grafana-ops.net/a/grafana-kowalski-app/apps/66)
- [Prod](https://ops.grafana-ops.net/a/grafana-kowalski-app/apps/67)

Pathfinder's separate Faro stream continues to report errors, sessions, views, logs, measurements, and mirrored analytics events under the gates and privacy invariants above. Disabling `pathfinder.frontend-telemetry` does not control Grafana core's recorder.

Removing plugin replay takes effect when a page loads the updated plugin; already-open tabs running an older version need a reload. Previously ingested recordings are not deleted by a plugin release.

## Investigating guide loading and rendering

A guide open carries an in-memory `load_id` from launch preparation through content fetching and the renderer. A successful `pathfinder_content_fetch` measurement means that content was fetched and shaped; it does not prove the guide appeared. Use `pathfinder_guide_render` for the final visible outcome. The mirrored `open_guide` action now finishes with this outcome on instrumented launches (`phase=render`); its `duration_ms` records active loading time.

| Signal                                          | What it explains                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pathfinder_guide_request`                      | Each HTTP attempt: source, file role, duration, HTTP status, and transport reason. Attempts in a fallback ladder share a load ID.                                           |
| `pathfinder_guide_render`                       | `rendered`, `error`, `timeout`, or `cancelled` terminal outcome. `awaiting-user` and `degraded` are intermediate states, not failed opens.                                  |
| `pathfinder_content_fetch`                      | Existing latency measurement, enriched with load ID and structured failure diagnostics.                                                                                     |
| `pathfinder_content_fetch_fallback`             | Existing fallback event, correlated with the load ID when supplied.                                                                                                         |
| `pathfinder_package_index`                      | Index availability, backend cache disposition/age, manifest failure counts by HTTP/timeout/JSON/other reason, enrichment-budget exhaustion, and suppressed session retries. |
| `pathfinder_custom_guide_catalogue_unavailable` | Existing private-catalogue signal, now preserving bounded transient proxy reasons and upstream status.                                                                      |

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

## Kiosk catalogs and launches

`pathfinder_kiosk_catalog_loaded` records the served `tier` (`override`, `configured`, `generic`, or `bundled`) and whether loading `degraded`. An unconfigured kiosk serves bundled rules without degradation. Cancelled loads emit no outcome. Catalog failure logs contain only the tier and a bounded reason; rejected rule logs name the invalid field without its value.

`KioskDemoStarted` includes `launch_mode` (`instance` or `presentation`). Since URL-selected kiosks were added, `target_instance` is the current origin for instance launches and the catalog target (or current origin) for presentation launches. Filter by `launch_mode = presentation` for booth-demo comparisons; older events lack this field. Catalog URLs, rule content, and raw failure messages are not added to catalog telemetry.
