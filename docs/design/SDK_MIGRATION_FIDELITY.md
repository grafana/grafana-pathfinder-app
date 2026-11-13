# SDK migration carryover acceptance

This gate supplements normal PR review. It compares the cumulative migration, not
only the removal of the compatibility adapter. A passing row is evidence for that
row's stated scope, not proof of the whole migration or deployment readiness.

## Frozen references

- Legacy baseline: `f106a8904174594c456b00edb1f67b6905f0cd8e`.
- Migration parent (#2404): `de47e2c44ff136b8bd7f7dd48b127eca334301a2`.
- SDK-only parent (#2405): `4f4f3c9daa11abb9cf284d3137b3e92a4b2f561d`.
- [David's acceptance request](https://github.com/grafana/grafana-pathfinder-app/pull/2405#issuecomment-6857024028).
- [Frozen behavioral contract](https://github.com/grafana/grafana-pathfinder-app/blob/f106a8904174594c456b00edb1f67b6905f0cd8e/docs/design/BACKEND_PROXY_PATTERN.md).

The backend CI job runs this comparative gate after its Go tests and fetches the frozen Git history. Record the actual head when running this gate. Existing SDK goldens establish schema
agreement and current behavior. They are not interchangeable with the frozen oracle.

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
Guide lists, catalogue visibility, and historical write sequences remain separate
from these individual-resource reads.

The runner exports the immutable baseline into a temporary directory and copies the
current Go implementation into a separate temporary checkout. It does not switch
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

| Difference                                                               | Reason and user impact                                                                                                             | Evidence / remaining decision                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Completion POST and assignment GET add `Cache-Control: no-store`         | Explicitly prevents caching private completion and assignment responses; does not change queue classification or persisted effects | Runner requires exactly absent on legacy and `no-store` on SDK; any other value fails                                      |
| SDK context replaces plugin ID-token verification and OBO minting        | Runtime owns ingress verification and caller delegation; provider binds the namespace exactly                                      | Provider identity tests, resourceaccess delegation test, local E2E; Cloud execution/key rotation verification remains open |
| Cache is partitioned by namespace **and caller**                         | Prevents SDK provider reuse from sharing caller-specific authorization results                                                     | Provider user isolation tests and new cache tests; changes upstream load volume                                            |
| Legacy resource endpoints removed                                        | Deliberate SDK-only architecture; existing browser adapters use SDK routes                                                         | Local E2E expects legacy RPC rejection; third-party callers must migrate                                                   |
| OSS without SDK uses plugin JSON settings                                | Preserves pre-existing OSS settings support; does not introduce an alternate SDK write store                                       | `settings-preservation.test.ts`; registered SDK failures cannot switch stores                                              |
| Raw guide/settings browser writes become SDK routes                      | Preserves caller authorization while moving server responsibilities to SDK                                                         | Local authoring/settings E2E; full historical CRUD differential corpus remains open                                        |
| Legacy unavailable-identity diagnostics and insights unavailable capture | SDK ingress owns authentication failure; injected-context tests do not establish every platform failure response                   | Explicit runtime failure matrix still required; do not mark equivalent by deleting an old fixture                          |

## Guarantee-to-evidence matrix

Paths below are relative to the repository root. “Current tests” means independent
invariants on the SDK implementation, not differential evidence. Open items remain
acceptance gaps; they are not asserted runtime defects.

| Baseline guarantee                                                              | New owner                                                                 | Permitted difference                        | Test/evidence                                                                                               | Unresolved gap                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Stable subject and record names; no browser identity override                   | `pkg/provider/completion_identity.go`, `pkg/services/completion_names.go` | SDK identity source                         | `TestExchangedTokenPreservesLegacyCompletionSubject`, provider write identity tests, frozen write snapshots | Runtime exchanged-token verification across deployment configurations                                              |
| Name claim has no email/login fallback                                          | `completionCaller`                                                        | None                                        | `TestCompletionDisplayNameDoesNotUseProfileFallback`                                                        | None for claim projection                                                                                          |
| Exact namespace binding; no cross-tenant resources                              | `callerNamespace`, `pkg/resourceaccess`                                   | SDK context                                 | Provider identity tests, `TestSettingsStoreDelegatesCallerThroughBoundedTransport`, local E2E               | Cloud execution deferred                                                                                           |
| Redirect/body bounds, caller delegation, complete pagination                    | `pkg/resourceaccess`, `pkg/services/catalogue.go`                         | Generated clients                           | Resourceaccess guide/completion/assignment pagination and bounded transport tests                           | Comparative transport deadline/error corpus                                                                        |
| Cache TTL, forced refresh interval, stale fallback, cooldown                    | `pkg/services/completion_cache.go`                                        | Per-caller keys                             | `TestCompletionCacheCarryover`, `TestFrozenFidelityCache`                                                   | Frozen single-caller transcript covers these transitions; multi-caller isolation has separate invariant tests      |
| Singleflight, waiter cancellation, invalidation fencing                         | Same                                                                      | Per-caller keys                             | `TestCompletionCacheSingleflightAndCancelledWaiter`, `TestCompletionCacheInvalidationFencesFlight`          | Stress scheduling is not exhaustive                                                                                |
| Caller-specific failure isolation                                               | Provider completion cache key and services cache                          | Per-caller keys                             | `TestCompletionSDKCacheFiltersUsersAndInvalidates`, cache carryover test                                    | HTTP error cooldown classification needs broader negative controls                                                 |
| Completion collation, source separation, historical partials                    | `pkg/services/completions.go`                                             | None                                        | Frozen history projections; existing collation tests                                                        | Two-page populated, empty, and failure envelopes compared; broader pagination limits have independent tests        |
| Retry deduplication, monotonic progress, optimistic versions, partial semantics | `pkg/services/completion_attempt.go`, provider write route                | `no-store` header                           | Frozen write sequences, `TestCompletionAttemptConcurrentUpdatesNeverRegress`, SDK client conflict test      | Differential concurrent scheduling; physical connection loss is now independently tested                           |
| Queue retry/retain/disarm/drop taxonomy                                         | Provider write errors and frontend write queue                            | Runtime authentication failure boundary     | Frozen failure statuses/bodies/Retry-After; existing `completion-write-client.test.ts` / queue tests        | Shared backend-to-browser classifier harness remains open; schema-not-ready and terminal validation cases compared |
| Completed retry repairs assignments and invalidates cache                       | Provider completion write, assignment dependencies                        | Narrow app-identity status write            | `TestCompletionRetryAfterConnectionLossRepairsAssignmentAndCache`, existing repair and ownership/RV tests   | Differential repair effects are not captured by write harness; SDK adapter uses a no-op sync callback              |
| Assignment lifecycle, duplicate rules, last-page caller records                 | `ReadAssignments`                                                         | None                                        | `TestAssignmentCarryoverLifecycleRulesAndPagination`, `TestAssignmentCarryoverDoesNotServeIncompleteList`   | Empty and failure envelopes compared at both read stages; populated HTTP sequence remains open                     |
| Assignment source precedence, cutoff and terminal evidence                      | `ObligationEvaluator`, provider source constructors                       | None                                        | Frozen history, migrated tutorial table, provider source parity tests                                       | Network source failures compared only by independent tests                                                         |
| Insights admin gate, rate limit before upstream work                            | `pkg/provider/insights.go`                                                | SDK verified claims                         | `TestInsightsAuthorizationPrecedesReadsAndPeriodParsing`, `TestInsightsRateLimitPrecedesResourceReads`      | Platform ingress authentication differential                                                                       |
| Insights bounded reads and incomplete-history honesty                           | `DrainInsights`, `ShapeLearningInsights`                                  | None                                        | Ported `TestLearningInsightsDrainBounds`, frozen complete/incomplete historical projections, evidence tests | First-page failures and partial completion pagination compared; assignment-page history remains open               |
| Settings exact missing status, unknown fields, optimistic saves                 | Settings services/client and frontend resolver                            | JSON fallback only without SDK registration | Services/resourceaccess settings tests; frontend preservation tests; local E2E                              | Frozen historical settings input/output corpus                                                                     |
| Published guide visibility, catalogue metadata, authoring CRUD                  | Provider guides/catalogue and resourceaccess guides                       | SDK transport                               | Existing provider/client tests and local E2E                                                                | Frozen historical guide corpus                                                                                     |
| Anonymous shared recommendation cache and bounded CDN fetch                     | `pkg/publiccontent`                                                       | New route                                   | Migrated publiccontent suite; `TestRecommendationsSDKFetchAndSharedCache`                                   | Schema golden remains synthetic; live CDN deployment is outside deterministic coverage                             |
| Capability envelopes and diagnostic classifications                             | SDK provider                                                              | Identity boundary changes above             | SDK contract suite; frozen write failure envelopes                                                          | Old 19 value fixtures not yet all exercised with identical SDK inputs; logs/metrics parity not established         |
| Health/configuration integration                                                | SDK runner and health route                                               | Legacy adapter removed                      | Local E2E health and legacy-route checks                                                                    | Local binary rollback passed; other deployment configurations remain unverified                                    |
| Survey own-user exception                                                       | Existing frontend survey adapter                                          | None intended                               | Existing frontend transport/security tests                                                                  | Not part of this differential harness                                                                              |
| Partial retention and rollback reader compatibility                             | Existing persisted schema and SDK reader                                  | None                                        | Existing partial-aware tests; no schema changes                                                             | Local binary rollback passed (below); Cloud rollout/rollback remains deferred                                      |

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
independent SDK evidence; the frozen write adapter's repair callback is still a
no-op, so the differential repair gap remains explicit.

On 2026-11-13, the dedicated Grafana OSS 13.3.0 instance at port 3302 was switched
from SDK-only `b62e8e0507725720a2a68e85f760964784267f00` to compatibility parent
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

This follow-up establishes a repeatable comparative gate and closes selected missing
carryover tests. It does **not** certify comprehensive equivalence. Reviewers should
resolve the open rows before declaring that standard met, and attach results to the
actual head they tested. Do not convert an open evidence gap into a claimed defect.

Cloud already supports the SDK prerequisites. Cloud execution/coexistence and Cloud rollout/rollback remain deferred; the
local rollback evidence above does not close those deployment-specific rows. Admin CLI, exporter, repository consolidation, admission rules and
background reconcilers remain outside this migration.
