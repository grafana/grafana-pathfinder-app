# Learning insights

Learning insights is the read-only, current-organization admin view of recorded learning evidence in Interactive learning. The full-page route is `/a/grafana-pathfinder-app/learning-insights`; its data comes from the real app plugin backend, not a dashboard template or a separate analytics service.

Load this reference when changing the reporting route, its frontend consumer, metric definitions, assignment evaluation, or admin access. The shared identity and transport foundation is [Backend App Platform proxy pattern](../design/BACKEND_PROXY_PATTERN.md). The reporting route deliberately does **not** adopt that pattern's availability-first reporting cache or stale replay.

## Entry points

- `src/pages/learningInsightsPage.tsx` — full-page route.
- `src/hooks/useLearningInsights.ts` — plugin-resource request, wire validation, loading/error state, and refresh. It clears previously displayed data before a new request; a failed refresh does not replay old results.
- `src/types/learning-insights.ts` — response types; `src/types/backend-api.schema.ts` validates the wire response.
- `pkg/plugin/learning_insights.go` — trusted admin gate, bounded namespace reads, aggregation, and read-only assignment snapshot.
- `pkg/plugin/assignment_satisfaction.go` and `assignment_paths.go` — source-qualified target membership and completion acceptance.

## Production rollout

The reporting UI is behind the default-off boolean MTFF flag `pathfinder.learning-insights`. It requires both an enabled flag and the current-org Admin role: the flag gates page registration, the My learning link, lazy page rendering, and mounting the reporting request hook. With it off, no reporting requests originate from the UI; normal My learning and completion recording continue unchanged.

Register the flag in MTFF as public with a remote default of `false`, then target only the production test stack's namespace with `true`. Deploy the packaged frontend **and backend**, reload Grafana, and run the smoke procedure below. Leave other stacks off. Roll back the UI by setting the target to `false` and reloading; this is not an instant kill switch for already-open pages or in-flight reads. Registration in `grafana/deployment_tools` is separate from the app-side flag definition; see [Feature flags](FEATURE_FLAGS.md#pathfinderlearning-insights).

The flag is a browser rollout control, not backend authorization. An authorized admin can still call the reporting resource directly when the UI is off. Non-admin denial, identity/OBO verification, namespace isolation, and the raw-resource RBAC limitation below remain independent release checks.

## Authorization and transport

`GET /api/plugins/grafana-pathfinder-app/resources/learning-insights` is the browser-facing resource (`GET /learning-insights` inside the plugin). The backend requires `PluginConfig.User.Role == "Admin"` in Grafana's trusted current-org RPC context. Missing user context and non-admin roles receive **403**. A browser role predicate only controls discovery/rendering; it is not the authorization boundary. Being a server administrator is not a substitute for this current-org role check.

The route also requires a cryptographically verified forwarded ID token bound to the exact trusted plugin-context namespace. It never accepts a namespace from the browser, trusts a caller-supplied role header, substitutes a service account, or falls back to an unverified identity. Missing/rejected identity or unverifiable namespace binding serves no records: an admin request receives the shared unavailable capability envelope rather than successful empty-stack evidence. Identity reason tokens follow the shared proxy pattern (`identity-unavailable`, `identity-unverifiable`, or `signing-keys-unreachable`).

Upstream App Platform LIST requests use the caller's on-behalf-of (OBO) access token. Missing OBO provisioning is unavailable, not permission to use an ambient credential. Neither session cookies nor an inbound Authorization header are forwarded as substitutes.

**Known accepted limitation:** broad raw GAP resource grants remain a separate issue. Guarding this reporting proxy does not repair upstream raw-resource RBAC or prevent other permitted raw API access. This MVP must not be presented as fixing those grants.

## Read contract

Optional `from` and `to` query parameters are RFC3339 timestamps. The interval is **[from, to)**: inclusive start, exclusive end. Defaults are midnight UTC today for `to` and 28 calendar days before that for `from`, covering the last **28 complete UTC days**, not a rolling 672 hours ending now. Invalid timestamps or `from >= to` receive **400**; non-GET methods receive **405**.

The response has these fields; arrays are never null:

| Field          | Meaning                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `asOf`         | Response shaping time in RFC3339; empty when unavailable. Not an atomic database snapshot or the time of the last learner activity. |
| `from`, `to`   | Effective chart interval.                                                                                                           |
| `capability`   | `available` and an optional machine-readable `reason`. Unavailable does not mean there are no learners or assignments.              |
| `completeness` | `complete` or `partial`, accompanied by `warnings`.                                                                                 |
| `people`       | Recorded subjects, with optional recorded login/display-name snapshots.                                                             |
| `completions`  | Deduplicated terminal guide evidence inside the interval.                                                                           |
| `assignments`  | Current assignment snapshot, independent of the chart interval, with per-guide credit and status/reason.                            |

Each request performs a fresh bounded read. There is **no reporting cache**, no cache hit bypassing authorization, and no stale replay; responses carry `Cache-Control: no-store`. The response's `asOf` describes the last successful read, not an automatic promise that the page is continuously live. The UI uses Grafana's native time picker and manual refresh control. Relative ranges are resolved again on refresh. UTC is the default; changing the time zone updates relative boundaries and all displayed dates.

The completion and assignment LIST drains each stop at **20 pages or 10,000 retained rows**, under a **30-second data-read/evaluation deadline after identity verification**. The shared client caps each page body at **8 MiB** (at most 160 MiB read per kind). These are safety limits, not total stack capacity promises. Continuation tokens are followed; repeated tokens, budget exhaustion, timeouts, unsupported reads, and failed fetches are reported rather than silently treated as complete coverage. Target-resolution failures remain unknown.

## Metric definitions

### Recorded completions

A guide completion is a distinct tenant/person/**guide source**/guide ID with terminal evidence in the selected interval. The namespace isolates the tenant before aggregation. The read projection requires a parseable completion timestamp and a terminal percentage of at least 100. Repeated attempts or records for the same person/source/guide count once per selected interval, assigned to the **earliest qualifying completion inside that interval**. A completion exactly at `to` belongs to the next interval. The `source` field on a completion row is its completion method; it is distinct from `guideSource`, which qualifies content identity.

Unique recorded completers are distinct subjects in those completion rows. Trends, guide rankings, and recent completions derive from the same deduplicated rows. The chart uses daily intervals for periods up to seven days, seven-day intervals up to 42 days, and larger whole-week intervals beyond that; the last interval may be shorter. Each bar exposes exact boundaries and count to keyboard and assistive-technology users without a redundant raw timestamp table. Rankings mean **most completed**, not most viewed or started. Recent completions are not a raw attempt/event stream: a later duplicate within the period does not replace its earliest qualifying row. Changing the interval can change which timestamp qualifies.

Do not join by title, bare guide slug, or display name. Do not sum path-level records and milestone-guide totals as equivalent guide completions. The stored contract lacks a guide-versus-journey discriminator: `learning-journey` rows count only when a nonempty `pathId` differs from `guideId` (identifiable milestone evidence). Other journey-shaped rows are excluded; `journey-identity-ambiguous` is emitted only when the excluded row falls inside the selected completion period. That exclusion does not make the namespace LIST incomplete or invalidate unrelated assignment history. Future milestone writes retain the parent ID when an explicitly typed journey/path manifest supplies it; an individual guide manifest is never inferred to be its own parent. Historical missing identities are not guessed or repaired. Evidence is self-reported, including manual/skipped/objective-based completion methods; it is **not attested mastery, compliance, or proof of a content revision**.

### Current assignments

The assignment snapshot evaluates all completion history retrieved within the read budgets, including evidence older than `from`, and applies each assignment's `acceptCompletionsFrom` cutoff. Changing the chart period must not change whether old accepted evidence satisfies a current obligation.

Direct guide targets use source-qualified identity. Path/track obligations resolve **current members**, using each member's source rather than blindly inheriting the path's source. There is no immutable membership or guide-revision attestation: historical content changes and identity ambiguities cannot be reconstructed as historical truth.

| Status        | Meaning                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `complete`    | All required guides have positive qualifying terminal evidence.                                                                       |
| `outstanding` | Target is resolvable, history coverage is complete, and not all required guides are credited.                                         |
| `overdue`     | A resolvable outstanding obligation whose due date has passed; a subset of outstanding obligations, not an additional disjoint total. |
| `unknown`     | Target/lifecycle cannot be evaluated, fetching failed, or incomplete history prevents a negative conclusion. Consult `reason`.        |
| `withdrawn`   | Withdrawn obligation; separate from active complete/outstanding totals.                                                               |

When history is partial, positive complete evidence can still prove completion, but missing credit cannot prove outstanding or overdue. Assignment guide credit is supported progress evidence; absence of a partial record is **not** evidence that a person never started. Reporting does not call `/assignments/my`, trust cached `status.satisfied` as truth, or write satisfaction status while reading.

### People and names

People are the union of subjects in retrieved completion and assignment records, including older completions outside the chart interval. There is **no roster join**: no adoption denominator, no percentage of stack members, and no disappearing subjects merely because a current user lookup fails.

The latest available recorded name snapshot is preferred. Display name/login can be absent or historical; fall back to the stable typed subject, never drop it. Name snapshots are labels, not identity keys. Last completion is not last activity. Partial namespace reads also mean the observed people list may be incomplete.

## Availability and incomplete evidence

Treat `capability.available == false` separately from a complete response containing zero rows. A backend version without the route, an identity/OBO problem, a transient request error, and an empty stack are different states.

A `partial` response is usable observed evidence, not a blanket statement that every metric is incomplete. The UI shows exact counts of available records and scopes limitations by source: completion read failures affect completing people, completion counts, rankings, recent completions and chart placement; assignment read failures affect assignment counts and follow-up coverage. Journey exclusions affect identifiable-guide completion metrics, not assignment LIST coverage. These exclusions do not add an expandable explanation or a page-wide warning; their identity contract is documented above. Actual incomplete reads retain visible recovery notices. Unknown diagnostics conservatively qualify both sources. Machine tokens are translated into impact and recovery guidance rather than displayed verbatim. Unknown assignment reasons include `target-unresolved`, `target-fetch-failed`, and `completion-history-incomplete`; they remain unknown rather than becoming zero progress or false outstanding.

A successful empty assignment read shows a concise no-assignment state, never a 0/0 ring. Failed or partial empty reads cannot show an all-clear. All people is the default and includes completion-only subjects; choosing a person filters a full-width assignment table, hides redundant person controls, and exposes a collapsed completion history. Selecting learning content in a row opens only that assignment's details, with technical identifiers collapsed. Resetting restores the full view. The UI calls unknown statuses “Needs review” with contextual explanations; withdrawn completion cells use a dash. Single-guide obligations use plain completion text, while paths retain completed-guide counts. Rule IDs are available only in the selected assignment's technical details, not as a filter or content column. Learning content uses Grafana's searchable, clearable Combobox with source-qualified options. Assignment and people sections have an explicit layout gap. Display titles use source-qualified completion snapshots where present and fall back to content IDs; the reporting API does not currently supply path titles or assignment acceptance cutoffs, so completion-date guidance is general rather than an invented policy. Dates are locale-aware with exact completion timestamps in tooltips. The completion method `objectives` is displayed as “Steps completed”.

No stale reporting payload is supplied after a failure. An unavailable response with empty arrays is not an authoritative zero. No-records copy is appropriate only after checking availability and completeness.

## Read-only live smoke procedure

### Prerequisites and current verification limit

Use an already deployed build containing both the page and plugin resource, with `pathfinder.learning-insights` enabled only for the test stack and Grafana reloaded. Obtain authorized current-org **Admin** and **Viewer** sessions, an available App Platform namespace, provisioned OBO exchange, and existing test records in that namespace. Do not assume Basic auth or a service-account token exercises the verified user-token/OBO path.

The initial local probe reached `http://localhost:3000/api/health`, but `admin:admin` returned **401** for authenticated access. Actual authenticated live reporting, permission enforcement, and the upstream round trip therefore remain **unverified** by that probe. Health success alone proves neither plugin deployment nor authorization.

Use existing or separately authorized disposable fixtures. Useful records include two subjects (one without a name), duplicate terminal completions for one source-qualified guide, exact `from`/`to` boundary timestamps, two guides sharing an ID but differing in source, an older accepted completion, and active/withdrawn/unresolvable assignments with due dates. An empty stack cannot validate deduplication or assignment credit. Fixture creation is a mutation and is **not** part of this smoke procedure.

### Checks

1. Read `/api/health`. Confirm the intended plugin build is installed through the existing deployment/operator evidence; do not rebuild, restart, deploy, or change plugin settings merely to run this check.
2. In the authorized Admin browser session, open `/a/grafana-pathfinder-app/learning-insights`. Inspect the GET resource response and `Cache-Control: no-store` in developer tools. Check availability, warnings, and `asOf` before interpreting totals. Verify the page uses the plugin resource rather than direct raw GAP reads.
3. Repeat the resource GET with explicit UTC bounds, for example:

   ```text
   /api/plugins/grafana-pathfinder-app/resources/learning-insights?from=2026-07-01T00%3A00%3A00Z&to=2026-07-29T00%3A00%3A00Z
   ```

   Compare against the existing fixture inventory: earliest duplicate wins, `from` is included, `to` excluded, source collisions stay separate, and missing names retain subjects. Change only the chart period and confirm older accepted evidence still credits assignments. Compare unknown and withdrawn rows separately from outstanding.

4. In the Viewer session, try both the page deep link and the **same resource GET directly**. The resource must return **403**, not tenant rows. Hiding navigation alone does not pass this check.
5. Check missing/invalid identity and missing/mismatched namespace using the plugin handler test harness or an already authorized disposable environment that supplies trusted plugin context. Expected outcome: no rows; an Admin request gets an unavailable identity capability, and a missing trusted user gets 403. A normal browser cannot manufacture missing trusted context. Do not forge headers, strip production identity forwarding, or alter tenant settings to simulate this against an external stack. If no safe harness/environment is available, mark these live cases unverified and use the backend tests instead.
6. Refresh without changing any records. Confirm another bounded read, no write requests, no satisfaction-status updates, and no replayed payload after a failed request. Use fixture/handler tests for budget, partial-history, timeout, and unknown-target cases that cannot safely be induced on the live stack.
7. Inspect the page in dark/light themes and with keyboard navigation at narrow and wide sizes. Use clearly labeled fixtures for local rendering checks; never introduce demo rows into the production request path.

Only GET reporting reads and local observation are authorized by this procedure. Do not create assignments/completions, contact people, trigger reminders, modify external services, change permissions, or alter namespace/OBO configuration without separate explicit authorization. Record skipped/unavailable cases honestly rather than claiming a successful integration.

## Scope boundaries

This release adds no roster integration, assignment creation/bulk mutation, automated contact, new database/CRD/warehouse, badge ledger, retry/error pipeline, inactivity-based stuck labeling, or content-revision attestation. Existing learning links are navigation, not evidence of a reporting-side mutation. Raw GAP authorization remediation remains explicitly separate.

## Earlier UI reference captures

These captures predate the PR #2218 dev-feedback corrections and are historical, not acceptance evidence for the revised layout. They show the earlier implemented React UI rendered locally with fictional test fixtures, not cloud-stack captures or generated mockups. The fixture banner is intentional; no demo data is included in the production request path.

- [Overview, dark theme](images/learning-insights/overview-dark.png)
- [Overview, light theme](images/learning-insights/overview-light.png)
- [Assignments and learner evidence](images/learning-insights/assignments-dark.png)
- [Assignments and learner evidence, narrow viewport](images/learning-insights/assignments-mobile.png)
