# SDK migration carryover acceptance

This gate supplements normal PR review. It compares the cumulative migration, not
only the removal of the compatibility adapter. A passing row is evidence for that
row's stated scope, not proof of the whole migration or deployment readiness.

## Frozen references

- Legacy baseline: `f106a8904174594c456b00edb1f67b6905f0cd8e`.
- Migration parent (#2404): `28bca4a50dbeab7da9d49ffe050ee968cb2d62df`.
- SDK-only parent (#2405): `8e5e9dd9ea69b328048f447eb8d3b3c270316a15`.
- [David's acceptance request](https://github.com/grafana/grafana-pathfinder-app/pull/2405#issuecomment-6857024028).
- [Frozen behavioral contract](https://github.com/grafana/grafana-pathfinder-app/blob/f106a8904174594c456b00edb1f67b6905f0cd8e/docs/design/BACKEND_PROXY_PATTERN.md).

The backend CI job runs this comparative gate after its Go tests and fetches the frozen Git history. Record the actual head when running this gate. Existing SDK goldens establish schema
agreement and current behavior. They are not interchangeable with the frozen oracle.

## Compatibility evidence from the November 19 review

The adaptive SDK handlers at the #2404 revision above reproduced the frozen write, history, cache and HTTP transcripts using the #2407 test adapters. The comparison uses the documented cache header, error-envelope and catalogue-name adjustments. The adaptive frontend routing and settings suites passed 81 checks. These runs used injected identities and local stores.

On Grafana OSS 13.1.0 and Enterprise 13.2.6, with SDK discovery returning 404, the SDK-only plugin's public feed returned 200 with 771 packages. POST returned 405 on both. Persisted features still require registered SDK routes. Jay Clifford owns the [Cloud promotion checks](../developer/SDK_CLOUD_ROLLOUT.md).

### Round 2 verification

The follow-up covers adaptive commit `ccd9fafc` and SDK-only commit `8756a8f3`.

| Review item                      | Executed check                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-1, SDK ingress                 | The authenticator tests verify expiry and audience, refresh a removed remote key, reject an off-origin redirect, and time out a stalled key endpoint.                                                                    |
| A-2, caller delegation           | Provider tests drive the SDK token exchanger and check that a Viewer write reaches the resource server with the exchanged token and preserves its 403. Missing or shared credentials leave tenant storage unreachable.   |
| B-1, D-1, H-3, catalogue retries | A deterministic clock covers the per-attempt and total deadlines. The HTTP comparison drains 300 large guide objects, retries the same cursor at a smaller page size, and resolves an assignment against the final page. |
| Older-host settings              | The settings network test performs a read and save after a discovery 404 followed by a 503 and verifies the store receiving the write.                                                                                   |
| BE-CREAD-01/04, BE-CROUTE-01     | Provider tests count other users' records toward the aggregate budget and exercise the unavailable read, capability and write responses before any store access.                                                         |
| BE-ASGN-02/03                    | Assignment handler tests check method, upstream status and retry headers, empty assignments and admission before reads. A burst against the production limiter admits twenty reads and throttles the next.               |
| BE-INSIGHT-03                    | Source and dispatch tests cover source-qualified membership, manifest reads, the verified namespace and authorization on successive requests.                                                                            |

Eight local browser checks passed against Grafana OSS 13.3.0, including guide publication, settings persistence, denied resource access and organization isolation. Cloud route registration, delegation and rollback still require Jay's environment-specific sign-off. Direct access to individual achievement resources needs a separate ownership check in the resource API.

## Run the comparative scenarios

From the repository root, with Go, Python 3.12+, Git and the baseline Git object available:

```sh
python3 scripts/sdk-fidelity/run.py
```

The cache transcript compares fourteen deterministic steps against the frozen
legacy cache: cold failure/cooldown, TTL boundary, forced refresh/throttling,
invalidation, denied refresh without cooldown, stale fallback, and recovery.
It records upstream load counts, returned index timestamps, and error presence.
A negative control doubles the production SDK cache TTL and must change the
transcript. This covers one caller; the SDK's intentional caller partitioning is
covered separately by isolation tests. It does not claim HTTP diagnostic parity.

Completion data and capability routes also run a 38-case HTTP comparison: empty
success, thirteen upstream HTTP statuses, malformed JSON, transport deadline, cancellation, and connection failures
across both routes. Status, complete JSON body, content type, cache control, and
Retry-After are compared. Only a successfully parsed server `asOf` is normalized.
The SDK adapter uses the generated client and its real error wrappers. This caught
lost `invalid-json` and `timeout` diagnostics, now repaired in #2404. A production
mutation back to `unexpected-error` must be detected. A two-page populated transcript covers duplicate completions, private/public source
collisions, partial progress, and caller filtering. A mutation that drops the SDK
client continuation token must be detected. The legacy adapter invokes the frozen
timestamp projection after decoding each spec, matching its LIST client. Settings additionally compare sixteen cases through real HTTP clients on both
sides: a successful resource with an unknown nested field and resource version,
plus thirteen upstream HTTP statuses, malformed JSON, and an oversized success
body. Full status, body, and cache/retry headers are compared. This caught the SDK
turning an oversized response into 503 instead of legacy 502 and losing the original
200 diagnostic status. A production mutation must detect that regression.
Eleven further settings cases compare explicit absence, legacy query behavior,
missing routes, wrong names/groups, unexpected causes, malformed/oversized error
bodies, and conflicting HTTP/body statuses. This caught 403/503 failures being
misclassified as successful absence; the HTTP status now stays authoritative and
a production mutation must detect the regression. Historical CRUD sequences and
other read-route failure corpora remain open.

Assignment reads add 35 HTTP comparisons: an empty successful list and seventeen
failure cases at each of the assignment-list and completion-history stages. These
cover thirteen HTTP errors, malformed JSON, deadline, cancellation, and connection
failure. The SDK side uses generated clients and real error wrappers; the frozen
side injects the equivalent list-client failures. Full response bodies and headers
must match, except the explicit `no-store` addition below. A production mutation that treats upstream 429 as terminal must be
caught. Populated assignment history and repair remain separate evidence below.

Learning insights add 35 HTTP comparisons: an empty complete report and the same
seventeen failures at each upstream read stage. These compare report completeness,
warning ownership/classification, arrays, period, status, and headers; only a valid
server `asOf` is normalized. A mutation that suppresses the completion-history
warning must be detected. Eighteen further cases load a first page containing public/private completions
with the same guide ID and a partial attempt, followed by success or each failure
on page two. They compare retained people/completion rows, completeness,
and warnings. Dropping the generated client's continuation token must change the
partial-report transcript. Assignment-page partial history and platform ingress
authentication remain separate from this corpus.

Individual guide reads add sixteen HTTP cases through real clients on both sides:
a draft with blocks, an unknown field, and a resource version; thirteen upstream
error statuses; malformed JSON; and a response exceeding the 8 MiB bound. The
full resource and error envelopes must match. This caught loss of the successful
upstream status when JSON decoding fails; a production mutation must detect it.
Guide lists and catalogue reads add 32 cases through real HTTP clients: two-page
resources with draft/published entries, blocks, unknown fields and resource versions,
thirteen upstream statuses, malformed JSON, and oversized responses. Both routes
must retain the final page; dropping continuation is a targeted production mutation.
The catalogue preserves status metadata and omits blocks, including draft metadata
as legacy does. The frontend paths test consumes this frozen response and verifies
that only published guide metadata reaches learning views; resolver tests separately
reject opening drafts. Historical write sequences remain separate from these reads.

The runner exports both committed revisions into separate temporary directories. It rejects uncommitted changes to the comparison harness. It does not switch
branches, alter the local running instance, or execute the old plugin against live
resources. Both sides consume the same scenario corpus and body construction. Thin
adapters bridge legacy HTTP identity/error types and SDK context/error types.

`scenarios.json` covers progress creation, equal/lower retries, completion, repeated
completion, lost-acknowledgement retry, conflict recovery/exhaustion, outage recovery,
403, 404, 429, and invalid progress. Each step compares status, JSON body, relevant
headers and the complete persisted fake-store snapshot, including names, namespace,
identity, resource versions and completion timestamps. The next write reads the
previous step's persisted state. The lost-ack scenario discards the first response
from the caller's perspective and resends the same request against that state.

Schema validation scenarios compare a partial rejected only for missing
`completedAt`, the same rejection on a completed record, a different missing
field, and mixed validation causes, each followed by a successful retry. They
compare retry hints, status, body, and persisted state. A mutation that accepts
unrelated validation causes as schema-not-ready must change the transcript.

Write transport scenarios compare deadline, cancellation, and connection failures,
each followed by recovery. The SDK fake store returns the SDK's real synthetic
503 wrapper around the same cause used by the frozen adapter. Status, retry hint,
full diagnostic body, and persisted effects must match. A mutation that replaces
the underlying cause with a generic HTTP diagnostic must be detected.
`TestResourceRoutesPreserveTransportFailureCause` additionally exercises the real
SDK completion writer and transport, alongside settings and catalogue readers.

`history.json` supplies identical historical completions, partials, source collisions,
duplicate completions, report boundaries, assignment cutoffs, duplicate rules,
withdrawal and the first-dashboard RSS identity case. It compares collation and
insights projections with both complete and incomplete history. These are domain
comparisons; they do not establish HTTP read-route equivalence.

The committed `baseline-writes.json` is generated by the frozen implementation and
checked on every run. `--record-baseline` regenerates it only from the pinned baseline;
review changes to the oracle independently from SDK changes. It also contains the
historical read projections. The runner intentionally fails on new differences.
Negative controls change a response status and reverse the production monotonic-progress comparison in the temporary SDK checkout. Both must produce a diff.

Only server-generated `recordedAt` wall time is normalized, after validating its
format and range. Client completion/attempt timestamps, identity, ordering, resource
versions and persisted effects are not normalized. The explicit header difference
below is checked on both sides before being accounted for.

## Differences requiring an explicit decision

| Difference                                                                         | Reason and user impact                                                                                                             | Evidence / remaining decision                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Completion POST, assignment GET, and resource writes add `Cache-Control: no-store` | Explicitly prevents caching private completion and assignment responses; does not change queue classification or persisted effects | Runner requires exactly absent on legacy and `no-store` on SDK; any other value fails                                      |
| Resource-write error Status adds empty `metadata`                                  | SDK serializes the Kubernetes Status type; status, reason, message and client failure handling are unchanged                       | Comparator permits only absent → empty metadata on these error bodies; all other fields remain compared                    |
| SDK context replaces plugin ID-token verification and OBO minting                  | Runtime owns ingress verification and caller delegation; provider binds the namespace exactly                                      | Provider identity tests, resourceaccess delegation test, local E2E; Cloud execution/key rotation verification remains open |
| Cache is partitioned by namespace **and caller**                                   | Prevents SDK provider reuse from sharing caller-specific authorization results                                                     | Provider user isolation tests and new cache tests; changes upstream load volume                                            |
| Legacy resource endpoints removed                                                  | Deliberate SDK-only architecture; existing browser adapters use SDK routes                                                         | Local E2E expects legacy RPC rejection; third-party callers must migrate                                                   |
| OSS without SDK uses plugin JSON settings                                          | Preserves pre-existing OSS settings support; does not introduce an alternate SDK write store                                       | `settings-preservation.test.ts`; registered SDK failures cannot switch stores                                              |
| Raw guide/settings browser writes become SDK routes                                | Preserves caller authorization while moving server responsibilities to SDK                                                         | Local authoring/settings E2E; full historical CRUD differential corpus remains open                                        |
| Legacy unavailable-identity diagnostics and insights unavailable capture           | SDK ingress owns authentication failure; injected-context tests do not establish every platform failure response                   | Local E2E and provider identity tests cover rejection; Cloud ingress remains deferred                                      |

## Guarantee-to-evidence matrix

Paths below are relative to the repository root. “Current tests” means independent
invariants on the SDK implementation, not differential evidence. The final column records coverage boundaries. Cloud execution remains deferred;
non-exhaustive scheduling and independent invariant tests are not claims of
differential coverage.

| Baseline guarantee                                                              | New owner                                                                 | Permitted difference                        | Test/evidence                                                                                               | Coverage boundary                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Stable subject and record names; no browser identity override                   | `pkg/provider/completion_identity.go`, `pkg/services/completion_names.go` | SDK identity source                         | `TestExchangedTokenPreservesLegacyCompletionSubject`, provider write identity tests, frozen write snapshots | Runtime exchanged-token verification across deployment configurations                                                                    |
| Name claim has no email/login fallback                                          | `completionCaller`                                                        | None                                        | `TestCompletionDisplayNameDoesNotUseProfileFallback`                                                        | None for claim projection                                                                                                                |
| Exact namespace binding; no cross-tenant resources                              | `callerNamespace`, `pkg/resourceaccess`                                   | SDK context                                 | Provider identity tests, `TestSettingsStoreDelegatesCallerThroughBoundedTransport`, local E2E               | Cloud execution deferred                                                                                                                 |
| Redirect/body bounds, caller delegation, complete pagination                    | `pkg/resourceaccess`, `pkg/services/catalogue.go`                         | Generated clients                           | Resourceaccess guide/completion/assignment pagination and bounded transport tests                           | Frozen read/write HTTP corpus covers deadlines, cancellation, network errors, malformed and oversized responses                          |
| Cache TTL, forced refresh interval, stale fallback, cooldown                    | `pkg/services/completion_cache.go`                                        | Per-caller keys                             | `TestCompletionCacheCarryover`, `TestFrozenFidelityCache`                                                   | Frozen single-caller transcript covers these transitions; multi-caller isolation has separate invariant tests                            |
| Singleflight, waiter cancellation, invalidation fencing                         | Same                                                                      | Per-caller keys                             | `TestCompletionCacheSingleflightAndCancelledWaiter`, `TestCompletionCacheInvalidationFencesFlight`          | Stress scheduling is not exhaustive                                                                                                      |
| Caller-specific failure isolation                                               | Provider completion cache key and services cache                          | Per-caller keys                             | `TestCompletionSDKCacheFiltersUsersAndInvalidates`, cache carryover test                                    | Nine real SDK failure cases pin cooldown and caller isolation; removing the cancellation guard must fail                                 |
| Completion collation, source separation, historical partials                    | `pkg/services/completions.go`                                             | None                                        | Frozen history projections; existing collation tests                                                        | Two-page populated, empty, and failure envelopes compared; broader pagination limits have independent tests                              |
| Retry deduplication, monotonic progress, optimistic versions, partial semantics | `pkg/services/completion_attempt.go`, provider write route                | `no-store` header                           | Frozen write sequences, `TestCompletionAttemptConcurrentUpdatesNeverRegress`, SDK client conflict test      | Two forced concurrent schedules compared under the race detector; physical connection loss independently tested                          |
| Queue retry/retain/disarm/drop taxonomy                                         | Provider write errors and frontend write queue                            | Runtime authentication failure boundary     | Frozen failure statuses/bodies/Retry-After; existing `completion-write-client.test.ts` / queue tests        | Frozen write responses drive the real frontend client, queue, and storage; platform ingress failures remain separate                     |
| Completed retry repairs assignments and invalidates cache                       | Provider completion write, assignment dependencies                        | Narrow app-identity status write            | `TestCompletionRetryAfterConnectionLossRepairsAssignmentAndCache`, existing repair and ownership/RV tests   | Frozen write sequences compare failed status persistence and completed-retry repair; status transport has independent tests              |
| Assignment lifecycle, duplicate rules, last-page caller records                 | `ReadAssignments`                                                         | None                                        | `TestAssignmentCarryoverLifecycleRulesAndPagination`, `TestAssignmentCarryoverDoesNotServeIncompleteList`   | Populated two-page views, duplicate rules, caller/lifecycle filtering, cutoff evidence and later-page failures compared                  |
| Assignment source precedence, cutoff and terminal evidence                      | `ObligationEvaluator`, provider source constructors                       | None                                        | Frozen history, migrated tutorial table, provider source parity tests                                       | Network source failures compared only by independent tests                                                                               |
| Insights admin gate, rate limit before upstream work                            | `pkg/provider/insights.go`                                                | SDK verified claims                         | `TestInsightsAuthorizationPrecedesReadsAndPeriodParsing`, `TestInsightsRateLimitPrecedesResourceReads`      | Platform ingress authentication differential                                                                                             |
| Insights bounded reads and incomplete-history honesty                           | `DrainInsights`, `ShapeLearningInsights`                                  | None                                        | Ported `TestLearningInsightsDrainBounds`, frozen complete/incomplete historical projections, evidence tests | Both completion and assignment histories compared through successful and failing later pages                                             |
| Settings exact missing status, unknown fields, optimistic saves                 | Settings services/client and frontend resolver                            | JSON fallback only without SDK registration | Services/resourceaccess settings tests; frontend preservation tests; local E2E                              | Shared create/update/conflict/denial sequence plus real browser preservation and E2E tests                                               |
| Published guide visibility, catalogue metadata, authoring CRUD                  | Provider guides/catalogue and resourceaccess guides                       | SDK transport                               | Existing provider/client tests and local E2E                                                                | Shared guide reads/lists and create/update/publish/delete sequence; live authoring E2E                                                   |
| Anonymous shared recommendation cache and bounded CDN fetch                     | `pkg/publiccontent`                                                       | New route                                   | Migrated publiccontent suite; `TestRecommendationsSDKFetchAndSharedCache`                                   | Schema golden remains synthetic; live CDN deployment is outside deterministic coverage                                                   |
| Capability envelopes and diagnostic classifications                             | SDK provider                                                              | Identity boundary changes above             | SDK contract suite; frozen write failure envelopes                                                          | 16 original and two updated catalogue fixtures match exactly; missing-identity insights explicitly changes to 403 before resource access |
| Health/configuration integration                                                | SDK runner and health route                                               | Legacy adapter removed                      | Local E2E health and legacy-route checks                                                                    | Local binary rollback passed; other deployment configurations remain unverified                                                          |
| Survey own-user exception                                                       | Existing frontend survey adapter                                          | None intended                               | Existing frontend transport/security tests                                                                  | Not part of this differential harness                                                                                                    |
| Partial retention and rollback reader compatibility                             | Existing persisted schema and SDK reader                                  | None                                        | Existing partial-aware tests; no schema changes                                                             | Local binary rollback passed (below); Cloud rollout/rollback remains deferred                                                            |

## Final fixture and diagnostic audit

The editor uses the slim catalogue and reads each guide by resource name. Both adapters retire the unused full-list endpoint removed on main in #2328. The SDK-only browser test checks that its former URL returns 404. The frozen legacy transcript retains its historical responses.

The gate runs both implementations' value-golden tests and compares 13 historical
fixtures without normalizing their bodies. Two populated catalogue fixtures use the pinned main revision from #2328, which adds the resource name and creation timestamp. The other 11 use the original baseline. Assignment and insights
capture inputs retain the original dates, rules and catalogue members. Three additional synthetic recommendation fixtures inject the base URL and diagnostics and are excluded from the historical count.
`TestRecommendationsSDKFetchAndSharedCache` separately exercises the actual fetch,
enrichment and shared cache rather than only injecting its response.

The nineteenth legacy fixture, `learning-insights.unavailable`, represented a 200
capability envelope for unavailable identity. SDK insights rejects missing identity
with 403 before any resource read. `TestInsightsWithoutIdentityRejectsBeforeResourceReads`
pins this intentional authentication-boundary change; it is not silently omitted
from the audit.

`TestCompletionFailureCooldownPreservesCauseAndCallerIsolation` drives real SDK
clients through 401, 403, 404, 429, 503, cancellation, deadline, network and malformed
JSON failures. Cancellation must re-probe, while outages cool down; a different
caller always performs its own read. This caught and fixed the SDK's synthetic 503
causing cancelled requests to enter the cooldown. The gate removes that guard as a
negative control. The cache adapter uses the production cooldown predicate and substitutes a fixed upstream-error reason.

Cache transition logs retain namespace-only values, lowercase `misses` and
`refreshFailures`, and classified failure reasons. A focused logging test prevents
the caller cache key from leaking into the namespace field. Counters are now scoped
per caller with their cache; SDK transport logs replace the removed bespoke
verification/client logs. Exact log byte identity is not an acceptance requirement.

Direct guide assignments reuse the existing reset confirmation when local progress
is complete but server assignment evidence requires a fresh completion. Tests cover
cancel, failed reset, a single awaited reset before launch, and a same-ID path that
must not become the direct guide's reset owner.

## Populated assignment views

A shared two-page assignment history drives both personal assignments and admin
insights. It includes duplicate rules on one guide, distinct public/private sources,
an acceptance cutoff, another caller, a withdrawn record, and last-page assignments.
Shared completed and partial history supplies the evidence. Success must retain all
five active caller assignments; later-page 403/503 failures must preserve legacy
capability/retry responses for the personal view and honest partial reports for
insights. Full bodies and headers are compared, with the documented no-store
addition on personal assignments. Dropping the generated assignment client's
continuation token must fail the independent last-page/caller-count invariant.
Status repair is covered by the separate write sequence and lost-acknowledgement tests. The HTTP harness cancels the first request context immediately after the fake store commits the record. It checks that assignment repair receives a usable context, drops the HTTP response after handler completion, and retries with a fresh request. The retry repairs the assignment and invalidates the cache without duplicating the record.

## Historical guide and settings writes

These writes previously went directly from the browser to App Platform, so there
is no legacy Go write handler to invoke. The guide-saving hook is unchanged from
the frozen baseline; settings save logic changes only through its endpoint helpers.
The shared resource sequence compares that direct HTTP boundary with the SDK
resource handler and client against the same simulated App Platform store. It
covers guide/settings creation, updates and publishing, stale-version conflicts,
authorization failure without mutation, and guide deletion/repeated deletion.
Each step captures status, full body, and the complete persisted object, including
resource versions, annotations and an unknown nested spec field. The API store
stamps namespace/version and enforces optimistic writes; this is transport/storage
comparison, not a second execution of the old React UI or live authorization.
Existing browser preservation tests and local authoring/settings E2E provide those
separate checks. Dropping annotations in the production SDK serializer must change
the resource transcript.

## Concurrent attempt carryover

The shared concurrent corpus seeds a 40% attempt, then makes 70% and 100% writers
read the same resource version before either can replace it. It forces each writer
to win first in separate scenarios. The real legacy and SDK upsert implementations
must agree on each writer's outcome and returned spec, the complete final resource,
resource version, and read/create/replace counts. The fake store enforces optimistic
versions; the losing writer must re-read after conflict and final progress must be
100%. Both schedules run ten times with the Go race detector on each implementation.
Reversing the production monotonicity condition must fail the independent progress
invariant. These are controlled overlapping updates, not exhaustive scheduling or
an HTTP concurrency test; route response mapping has separate shared-corpus tests.

## Frontend queue carryover

`src/completion-records/completion-write-fidelity.test.ts` reads the frozen backend
write transcript used by the Go comparison gate. Fourteen cases feed its status
and body through the real `postCompletionRecord`, write queue, and localStorage
implementation. The assertions distinguish successful removal, terminal drop,
retry with the same idempotency key, and forbidden/missing-route retention until
a new session drains the backlog. Schema-not-ready, validation errors, conflicts,
outages, throttling, and transport failures are included. The transport boundary
is a Grafana `FetchError` mock because backendSrv strips retry headers; this is
not a live browser ingress test. Temporarily changing the production client's 403
classification to terminal was detected by the forbidden-recovery case.

## Public recommendation route

`TestRecommendationsSDKFetchAndSharedCache` runs isolated child processes so each
scenario begins with an empty public cache. It stubs the CDN HTTP transport while
using the production fetcher, repository parser, manifest enrichment, cache,
`ReadRecommendations`, and SDK route. Success checks the derived `/packages/`
base URL and enriched manifest; outage and malformed-JSON scenarios check HTTP 503
and diagnostic classification. An anonymous request followed by an authenticated
request in another namespace must reuse the shared result without additional CDN
fetches. Authorization and cookie headers must never reach the CDN.

This is deterministic integration evidence, not a live CDN test or a replacement
for the existing synthetic schema golden.

## Interrupted responses and local rollback

`TestCompletionRetryAfterConnectionLossRepairsAssignmentAndCache` runs the SDK
write handler behind a real HTTP server. It closes the TCP connection after the
completion commits but before its response is sent, with the first assignment
status persistence simulated as unsuccessful. A retry must keep the same record
and completion timestamp, perform no replacement, repair assignment satisfaction,
and invalidate the caller's cache. The test passes under `go test -race`. This is
independent SDK evidence. The frozen write comparison now also runs the legacy
synchronizer and SDK `SyncSatisfiedAssignments` with the same persisted completion
history and guide assignment. It records assignment/history reads, status-write
attempts, satisfaction, and resource version after every write. The first status
persistence fails; a completed retry must repair it without creating another
completion. The status store is simulated and background dispatch is synchronous
for this comparison; generated status transport and real disconnect handling have
independent tests. A mutation that skips repair on completed retries must change
the lost-acknowledgement transcript.

On 2026-11-13, the dedicated Grafana OSS 13.3.0 instance at port 3302 was switched
using pre-rebase local builds, from SDK-only `b62e8e0507725720a2a68e85f760964784267f00` to compatibility parent
`132e4430566e2cc722c87b1dc703a6d7757965fa`, then restored. The same published guide,
40% partial completion, and settings resource were read through SDK routes at
all three stages. Full resource snapshots, including resource versions, matched
exactly (SHA-256 `d4173c8812f8f49ecc25871b11038cb6b033abce0f58a9ef27d043ff63d661db`).
The partial remained readable in personal progress with no `completedAt`.
Temporary guide/completion probes were removed, caches were cleared by restart,
and the SDK-only instance was left running.

This proves local rollback to the parent's SDK-capable compatibility runtime with
unchanged registration and storage. It does not prove Cloud registration rollback
or legacy OBO routes on OSS. To repeat on an isolated instance: build both Linux
binaries, save disposable guide/partial probes through SDK routes, snapshot those
resources and settings, atomically replace the runtime binary and restart Grafana,
compare the same reads on the parent, then restore the SDK-only binary in a
`finally`/shell trap and compare again before deleting the probes.

## Acceptance decision

The local migration acceptance work is covered by the frozen comparisons,
independent invariants, browser journeys, and binary rollback above. The full local
pre-merge checks pass; attach CI results to the actual head tested. The corpus is
bounded and does not claim every possible concurrent schedule or deployment.

Cloud already supports the SDK prerequisites. Cloud execution/coexistence and Cloud rollout/rollback remain deferred; the
local rollback evidence above does not close those deployment-specific rows. Admin CLI, exporter, repository consolidation, admission rules and
background reconcilers remain outside this migration.

## Achievements added from main

Achievements landed after the original frozen baseline. The gate therefore uses
the main revision that added Echo sources, `3e24d681`, for the nine achievement response
fixtures and the original store contract tests. The original eighteen-fixture
comparison and write/read mutation controls remain unchanged. SDK persistence
passes the same `pkg/achievements/storetest` contract against a schema-enforcing
HTTP server, including version conflicts, duplicate awards, evaluator recovery,
and durable saves with unreadable acknowledgements.

On 2026-11-16, the SDK achievement routes passed against real local Grafana
storage with a temporary, known definitions catalogue: successful writes,
personal reads, retry deduplication, and cross-namespace rejection. The normal
binary was then restored and passed all existing OSS journeys plus the achievement
availability check (six Playwright tests including authentication setup; the
fixture-only write test is skipped on the normal build).

The public CDN definitions URL currently returns 404, so the normal build reports
`503 definitions-unavailable` with `Retry-After`. Successful write acceptance used
a test-only Go build overlay, not the public catalogue; it does not prove catalogue
publication. The helper and restoration instructions are in
[Local achievement acceptance](BACKEND_PROXY_PATTERN.md#local-achievement-acceptance).
No legacy HTTP adapter remains in the running normal SDK build. Existing local
data is retained. Cloud verification remains deferred.

The catalogue comparison adds the historical resource name from the raw guide metadata before comparing entries. Local injected identities exercise handler behavior. Signed ingress and outbound caller delegation require verification on registered OSS and in each Cloud environment.
