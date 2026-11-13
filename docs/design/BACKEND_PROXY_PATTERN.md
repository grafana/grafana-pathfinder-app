# SDK backend and resource access

Pathfinder uses the Grafana App SDK provider in `pkg/provider`. The Go executable
starts `sdkplugin.Run(provider, ...)`, following the
[SDK test app](https://github.com/grafana/app-examples/tree/main/example-appsdktest-app).
It has no `WithAppFunc`, legacy `CallResource` adapter, or `pkg/plugin` implementation.
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
is OSS 13.3.0 with the flags above. Registered SDK failures never fall back to JSON
writes. A settings resource already read remains authoritative.

`grafana.useRouterMiddleware` is a server-only feature toggle (`Generate{Go: true}`
in Grafana's registry), so the frontend cannot include it in `usesSdkBackend()`.
It is a local runtime prerequisite, not an observable frontend capability flag.

The SDK runner supplies default plugin health integration. SDK `backend/health`
also returns the application health response.

## Route inventory

All browser backend requests use:

`/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{namespace}/backend/{route}`

| Route                           | Methods                | Responsibility                                         |
| ------------------------------- | ---------------------- | ------------------------------------------------------ |
| `pathfinder-settings`           | GET, POST, PUT         | Read, create, and update the default settings resource |
| `custom-guide`                  | GET, POST, PUT, DELETE | Guide item access and authoring                        |
| `custom-guides`                 | GET                    | Complete guide resources for the authoring library     |
| `custom-guide-repository`       | GET                    | Catalogue metadata                                     |
| `completion-records`            | POST                   | Completion creation and attempt progress               |
| `completion-records/my`         | GET                    | Current caller's collated progress                     |
| `completion-records/capability` | GET                    | Completion availability and progress support           |
| `assignments/my`                | GET                    | Current caller's assignments and satisfaction          |
| `learning-insights`             | GET                    | Admin-only learning aggregation                        |
| `package-recommendations`       | GET                    | Anonymous public recommendation catalogue              |
| `health`                        | GET                    | SDK application health                                 |

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
and absence of the old `/api/plugins/grafana-pathfinder-app/resources/*` handlers.
Grafana 13.3 maps the SDK runner's unimplemented `CallResource` RPC to HTTP 500
with `plugin.requestFailureError`; server logs identify `plugin.notImplemented`.
Leave the built SDK-only instance running with persistent test data. Cloud testing
and production rollout remain deferred.
