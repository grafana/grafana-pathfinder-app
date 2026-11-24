# SDK backend and resource access

Pathfinder uses the Grafana App SDK provider in `pkg/provider`. The Go executable
starts `sdkplugin.Run(provider, ...)`, following the
[SDK test app](https://github.com/grafana/app-examples/tree/main/example-appsdktest-app).
Tenant routes use the SDK provider. The public recommendations compatibility feed uses a separate plugin instance registered with `WithAppFunc`.
Grafana launches this executable to run the SDK application. Removing the executable
would require a separately hosted application server.

## Runtime and registration

The verified local runtime is Grafana OSS 13.3.0 with these flags:

- `appplugins.loadAppManifest`
- `appplugins.registerAPIServer`
- `grafana.useRouterMiddleware`

The frontend plugin manifest and generated SDK app manifest ship together. The SDK
provider registers the existing `pathfinderbackend.ext.grafana.app/v1alpha1` kinds
and custom routes. Resource names, versions, and schemas remain unchanged. Existing
resources remain in Grafana's resource store across plugin restarts.

Cloud stacks already support the SDK prerequisites. Cloud execution and coexistence
with the existing manifest-only registration have not been exercised in this local
test run; that validation remains deferred. Do not change Cloud registration as part
of local testing. The SDK-only implementation replaces the legacy transport; the
parent migration PR is the code rollback point.

OSS installations without SDK registration retain plugin `jsonData` settings reads
and writes. They did not previously support App Platform backend features. Keep the
existing frontend Grafana minimum; the verified runtime for the new backend features
is OSS 13.3.0 with the flags above. On self-hosted Grafana before 13.3, the host can advertise both registration flags even when SDK health returns 404. That combination keeps plugin JSON settings available until discovery succeeds. An outage, an unknown host version, or a Cloud namespace keeps SDK storage authoritative. Registered SDK failures never fall back to JSON
writes. A settings resource already read remains authoritative.

`grafana.useRouterMiddleware` is a server-only feature toggle (`Generate{Go: true}`
in Grafana's registry), so the frontend cannot include it in `usesSdkBackend()`.
It is a local runtime prerequisite, not an observable frontend capability flag.

The public-feed plugin instance answers the standard Grafana plugin health check. SDK `backend/health`
also returns the application health response.

## How to add or change a route

Follow `POST backend/completion-records` from a reader's click to the durable record. The SDK steps register and dispatch the request. The identity, storage, caching, and retry policies below are Pathfinder's contract for tenant features.

1. **Register the method and path.** In `kinds/manifest.cue`, find `createBackendCompletion`. Declare the new route alongside it under the namespaced API version and run `npm run generate:kinds`. In `pkg/provider/provider.go`, register the same method and path in `VersionedCustomRoutes` and supply its handler. Check how an unprovisioned client answers the route too. Add a dispatch case for the new endpoint (see `TestProviderDispatchesSettingsRoute` and `TestUnprovisionedAndSharedCredentialsCannotAccessTenantStores`). A manifest entry alone cannot exercise the handler.
2. **Call it from the browser.** Add the relative path to the allowlist in `src/lib/backend-routes.ts`. Follow `src/completion-records/completion-write-client.ts`, which sends its POST to `backendRoute('completion-records')`. The helper supplies the host namespace. Keep tenant operations on that route when the backend is unavailable. The browser transport guard lives in `src/validation/app-platform-transport.test.ts`.
3. **Establish who can act before touching storage.** In `completionWriteHandler`, `completionCaller(ctx, req.ResourceIdentifier.Namespace)` derives the subject from verified ingress identity and checks the namespace for exact equality. Apply the route's authorization using that caller. Use the caller's context and namespace with the generated resource client. Reject missing delegation, including a shared bearer credential. Exercise a wrong namespace, a forged body identity, and an unauthorized caller with zero upstream writes. See `TestCompletionCallerUsesAuthenticatedNamespace`, `TestSDKCompletionWritesPreserveIdentityProgressAndRepair`, and `TestUnprovisionedAndSharedCredentialsCannotAccessTenantStores`.
4. **Bound requests and expose failures.** The completion handler limits the incoming body before decoding. Reuse the bounded client in `pkg/resourceaccess` for upstream calls and propagate the route's error or capability response. A denied or failed read must never authorize a write, imply an empty store, or trigger another credential or transport. Use `TestSettingsStoreDelegatesCallerThroughBoundedTransport`, `TestSettingsTransportRefusesRedirect`, and `TestSettingsRouteDoesNotMistakeUpstreamFailureForAbsence` as examples.
5. **Define retry behavior for writes.** Follow the attempt-ID branch: `CompletionAttemptRecordName` derives a stable name from the subject and attempt ID, and `UpsertCompletionAttempt` handles concurrent updates. Replaying a completed attempt must repair side effects without duplicating the record or advancing completion again. For updates to an existing resource, preserve its identity and use its resource version. Exercise a duplicate and a lost acknowledgement as in `TestCompletionRetryAfterConnectionLossRepairsAssignmentAndCache`.
6. **Scope any cache to the data it contains.** Start an uncached read with the caller-delegated client. If you add a personal cache, follow the sibling `GET backend/completion-records/my` handler: partition by verified namespace and subject, including failure cooldowns, and invalidate the same caller's entry after a write. Reserve process-wide caches for anonymous public content. See `TestCompletionSDKCacheFiltersUsersAndInvalidates` and `TestRecommendationsSDKFetchAndSharedCache`.

For review, trace the browser call through both registrations to the upstream client. Run the affected route tests and exercise the route over HTTP on a registered SDK host using the [local acceptance procedure](#local-acceptance).

## Route inventory

Tenant requests and the preferred public-feed request use:

`/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{namespace}/backend/{route}`

| Route                             | Methods                | Responsibility                                         |
| --------------------------------- | ---------------------- | ------------------------------------------------------ |
| `pathfinder-settings`             | GET, POST, PUT         | Read, create, and update the default settings resource |
| `custom-guide`                    | GET, POST, PUT, DELETE | Guide item access and authoring                        |
| `custom-guide-repository`         | GET                    | Catalogue metadata                                     |
| `completion-records`              | POST                   | Completion creation and attempt progress               |
| `completion-records/my`           | GET                    | Current caller's collated progress                     |
| `completion-records/capability`   | GET                    | Completion availability and progress support           |
| `assignments/my`                  | GET                    | Current caller's assignments and satisfaction          |
| `learning-insights`               | GET                    | Admin-only learning aggregation                        |
| `package-recommendations`         | GET                    | Anonymous public recommendation catalogue              |
| `api/v1/achievements/events`      | POST                   | Record an achievement event                            |
| `api/v1/achievements/my`          | GET                    | Read personal achievements                             |
| `api/v1/achievements/definitions` | GET                    | Read the public definitions catalogue                  |
| `health`                          | GET                    | SDK application health                                 |

The frontend `backendRoute()` helper allows only this bounded route inventory,
derives namespace from Grafana runtime configuration, and rejects missing or
wildcard namespaces. Guide/settings URL helpers reject a namespace that differs
from that runtime configuration. They have no legacy-route or raw-resource CRUD
fallback. SDK availability requires the SDK registration flags and a concrete
namespace; the old Cloud aggregation toggle alone is insufficient.

## Identity and namespace boundaries

SDK ingress supplies the authenticated authlib identity. Handlers use that verified
context; browser headers and JSON identity fields are never an identity source.
The context namespace must exactly equal the route namespace. Missing or wildcard
namespaces fail closed. Admin authorization uses authenticated claims bound to the
same subject and namespace. The URL namespace is a routing input, not authority.

`pkg/resourceaccess` uses SDK-generated kind clients and the runtime's client
generator, preserving request context and caller delegation. Resource clients
refuse redirects, bound response bodies, and retain the authenticated namespace.
Do not recreate a bespoke JWT verifier, OBO exchanger, service-account fallback,
or cookie/header forwarding in a handler.

Completion records derive user ID, profile, organization, and stack namespace from
trusted identity. Client-supplied user, organization, and namespace fields cannot
override these values. Read responses filter personal records by trusted subject.
Unauthorized requests must not reach resource clients or reuse another user's cache.

Assignment status synchronization is a narrow app-identity exception: Grafana
reserves status mutations for service identities. Delegated reads first establish
caller ownership and completion satisfaction. `MarkSatisfied` checks the verified
namespace and subject against the assignment, requires its resource version, and
uses a bounded app-identity context to update status. Guide, settings, and completion
writes remain caller-delegated. Do not extend this exception to arbitrary CRUD.

## Services and resource contracts

`pkg/services` owns transport-independent behavior. `pkg/provider` owns SDK handlers
and identity gates. `pkg/resourceaccess` owns generated-client access.
`pkg/publiccontent` owns public recommendation caching and online assignment lookup.

Preserve the existing contracts when editing these packages:

- Drain continuation tokens, not just the first page. Retain per-page body bounds,
  aggregate item/byte budgets, and aggregate deadlines. Report budget exhaustion;
  do not silently treat an incomplete drain as complete evidence.
- Keep existing page sizes, timeouts, retry delays, rate limits, capability envelopes,
  diagnostics, and terminal-versus-transient error classification.
- Confirm missing settings from the exact Kubernetes resource status; an arbitrary
  404 does not prove the singleton is absent. Keep unknown JSON fields on read/update.
- Preserve full guide resources in authoring and published visibility in consumers.
  Catalogue metadata and optional manifest fields must survive round trips.
- Assignment satisfaction requires matching guide identity/source, terminal progress,
  and a valid completion timestamp at or after `acceptCompletionsFrom`. Missing
  members and failed lookups must not become satisfied assignments.
- Learning insights requires admin identity, preserves aggregation and partial-data
  warnings, and keeps historical assignment evidence distinct from period totals.

The Go contract fixtures in `pkg/provider/testdata/contract` capture SDK handler
responses. Reflection inventories JSON fields, types, and omission rules; the
frontend checks them against `src/types/backend-api.schema.ts`. Normalize only the
validated dynamic `asOf` timestamp in fixture capture. Regenerate intentional
changes with `go test ./pkg/provider -run TestContract -update` and review the wire
diff. Identity denial for insights is an HTTP 403, covered by authorization tests.

## Cache isolation

SDK providers can serve more than one caller. Completion cache keys include both
namespace and authenticated subject. Availability and error entries must not leak
across either boundary. Writes invalidate every completion-cache entry in the
affected namespace, including in-flight generations. Detached refreshes and
assignment repairs retain identity context and have bounded resource operations.

Recommendations are deliberately different: they fetch public CDN content
anonymously and retain a shared process-wide cache. Per-user or tenant-private
content must never enter this cache. Keep public fetch host validation, redirect
restrictions, response-size limits, enrichment bounds, stale fallback, and existing
failure responses. Online assignment lookup shares public content only.

## Completion writes

Stable names bind an idempotency key or attempt ID to the authenticated subject.
Retries reuse the same record; both interrupted responses and duplicate requests
must remain safe. Attempt updates use optimistic resource versions and bounded
conflict retries. Progress is monotonic: equal/lower updates return stored progress,
and retries never replace the original completion timestamp.

Partial records omit `completedAt`; they are not completed-guide evidence. On
reaching 100%, the completion fields are populated. Preserve unknown fields,
metadata, and the original attempt-start annotation during updates. A schema that
requires `completedAt` for a partial is a retryable `schema-not-ready` response;
other validation errors retain their existing failure semantics.

Committed completions synchronize assignments and invalidate caches. An unchanged
completed retry still repairs assignments/cache state; an unchanged partial does
not invent completion evidence. Never dual-write through two transports.

Partial records persist without expiry. The browser queue's 30-day expiry does
not delete stored partials. A rollback to a reader that does not understand partial
records requires stopping writers and safely removing unfinished records first;
otherwise retain the partial-aware reader. The parent SDK migration already reads
partials. Retention policies, new admission rules, and background reconcilers remain
separate work unless needed to preserve an existing guarantee.

## Frontend transport enforcement

`src/validation/app-platform-transport.test.ts` rejects direct App Platform resource
reads through `getBackendSrv()` and recognizes the exact bounded SDK helper. A
similarly named helper or arbitrary `/apis/` URL does not bypass the rule. All
Pathfinder guide/settings mutations use SDK handlers as well.

The signed-in survey compatibility read in `src/lib/onboarding-survey-intent.ts`
remains a narrow exception: Grafana's own-user `userstorage.grafana.app/v0alpha1`
API authorizes the record against the authenticated UID. Namespace and UID come
from signed-in runtime context. Anonymous callers do not read or enroll; failures
leave the experiment ineligible. This is unrelated to Pathfinder resource CRUD.

## Local acceptance

The dedicated instance is http://localhost:3302 (admin/admin). Do not repurpose
another local Grafana instance. Run:

```sh
PATHFINDER_SDK_E2E=1 GRAFANA_URL=http://localhost:3302 npx playwright test tests/sdk-guide-authoring.spec.ts --project=chromium
```

Acceptance covers block-editor creation/save/reload/edit/publish/delete, settings,
completion persistence, assignment satisfaction/status synchronization, and admin
learning insights. Also verify denied writes and cross-namespace reads, SDK health,
and HTTP 404 on retired tenant resource paths. The GET-only public recommendations route remains available through plugin resources.
Leave the built SDK-only instance running with persistent test data. Cloud testing
and production rollout remain deferred.

### Achievement routes

The SDK also serves `backend/api/v1/achievements/events` (POST),
`backend/api/v1/achievements/my` (GET), and
`backend/api/v1/achievements/definitions` (GET). The SDK owns these routes and their persistence; the legacy adapter is removed.

Only authenticated user principals can submit or read achievements. SDK writes
stamp the caller and namespace from verified authentication and use delegated
clients. Award names remain deterministic and awards are create-only. Progress
uses resource-version concurrency; a successful save with an unreadable response
remains durable and forces the next update to reload. The events limit is 30
requests with a refill of 0.5 per second, isolated by namespace and user.

Personal reads drain both resource kinds with 100-item pages, a 50,000-record
aggregate cap, 15-second page deadlines, and a 30-second overall deadline. They
filter the caller before shaping the result, expose truncation, and do not cache
personal state. Public CDN definitions retain their existing shared cache and
failure backoff; caller credentials never reach the CDN.

Achievement schemas are copied from the exact backend revision used by the
merged store tests (`84c582fdae1916910e5197a44bd0078018315135`, backend PR #146).
Their resource names, versions, schemas, and award create-only role are preserved.
The local SDK provider registers these kinds; this is not evidence of Cloud
registration or deployment. There is no new achievement frontend in this change.

### Local achievement acceptance

The public definitions URL returned 404 during the 2026-11-16 test. The normal
build reports `503 definitions-unavailable` with `Retry-After` until that catalogue
is published. This is an upstream dependency, not a resource-store failure.

Run the normal local journeys with:

```sh
PATHFINDER_SDK_E2E=1 GRAFANA_URL=http://localhost:3302 npx playwright test tests/sdk-guide-authoring.spec.ts tests/sdk-achievements.spec.ts --project=chromium
```

For successful achievement-write acceptance before publication, build a temporary
catalogue fixture. This replaces only the public definitions constructor via a Go
build overlay; routes, authentication, delegated clients, and Grafana storage are
real. It does not modify repository sources:

```sh
python3 scripts/build-sdk-achievement-fixture.py --output /tmp/pathfinder-sdk-achievement-fixture --goarch arm64
```

Use `--goarch amd64` for an x86 Grafana container. With the existing dedicated
local instance and plugin mount at `/tmp/pathfinder-sdk-local`, back up the normal
binary, install the fixture atomically, restart, and test. Restore the normal
binary even if the test fails; do not publish the fixture build:

```sh
binary=/tmp/pathfinder-sdk-local/gpx_grafana-pathfinder-app_linux_arm64
cp "$binary" /tmp/pathfinder-sdk-normal-backup
restore_sdk() { cp /tmp/pathfinder-sdk-normal-backup "$binary.next" && mv "$binary.next" "$binary" && docker restart pathfinder-sdk-migration; }
trap restore_sdk EXIT
cp /tmp/pathfinder-sdk-achievement-fixture "$binary.next"
mv "$binary.next" "$binary"
docker restart pathfinder-sdk-migration
curl --fail --retry 20 --retry-delay 1 --retry-connrefused http://localhost:3302/api/health
PATHFINDER_SDK_E2E=1 PATHFINDER_ACHIEVEMENTS_FIXTURE=1 GRAFANA_URL=http://localhost:3302 npx playwright test tests/sdk-achievements.spec.ts --project=chromium
```

The fixture test checks persistence, retry deduplication, ignored body-supplied
identity, personal reads, and cross-namespace refusal. It creates achievement
records for the test user. The normal build and all existing data remain in place
after restoration. Cloud testing remains deferred.

The public package feed is the one plugin resource retained for hosts without SDK routes or anonymous SDK access. Both GET paths call the same anonymous CDN reader and process cache. It has no tenant store or write operation. Grafana 13.1 remains supported.
