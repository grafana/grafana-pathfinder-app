# Backend App Platform proxy pattern

**Scope:** plugin-backend (`pkg/plugin/`) routes that proxy a paginated App Platform CRUD
endpoint served by the pathfinder-backend aggregator. Both current proxies — completion records
and the custom-guide catalogue — address `pathfinderbackend.ext.grafana.app/v1alpha1`; the older
`pathfinderbackend.ext.grafana.com/v1alpha1` group is legacy and no longer gates either surface.
A group's boot toggle says its aggregation layer is served, which is a precondition and not the
availability answer — see §8.

**Why this doc exists:** pathfinder-backend is CRD-only — only its manifest deploys, custom
server code never runs — so every piece of intelligence (identity, caching, collation, failure
handling) lives in plugin-backend proxies. Two such proxies were built contemporaneously
([#1398](https://github.com/grafana/grafana-pathfinder-app/pull/1398) completion records,
[#1400](https://github.com/grafana/grafana-pathfinder-app/pull/1400) custom guide catalogue) and
diverged on nearly every load-bearing decision. This document synthesizes two independent design
reviews of both PRs (2026-07-22), with every contested claim verified against the PR diffs, the
baseline `pkg/plugin/package_recommendations.go`, and repo history. Future PRs of this shape
should implement this pattern rather than re-deriving it; divergence should be deliberate and
documented in the PR body.

The shape, in one sentence: **a GET route that drains a paginated namespace LIST upstream, caches
the shaped result in-process, serves it fast and availability-first, and rides the caller's own
identity end to end.**

---

## 1. Upstream client

Use **one shared paginated LIST client** (lister-interface seam — these are API-server LISTs, not
flat byte fetches). It must:

- send `limit=<N>` and loop the k8s `metadata.continue` token until exhausted. **A proxy that
  reads one page has a silent-truncation bug** — the aggregator's server-side default page size
  truncates without any error, so a hard byte cap alone does not protect coverage;
- bound each page body with `io.LimitReader(maxBytes+1)` + post-read check;
- enforce an **aggregate budget across pages** — max-total-items or max-total-bytes — and **log
  when it trips; never truncate silently**;
- apply a **per-page timeout AND one aggregate deadline** around the whole drain. This is
  load-bearing because the refresh runs detached from the request (see §4): without an aggregate
  deadline, an N-page drain under `context.WithoutCancel` is bounded only by N × per-page-timeout
  — detached must not mean unkillable. Derive the detach as
  `context.WithTimeout(context.WithoutCancel(ctx), aggregateDeadline)`;
- classify errors once, on two **orthogonal** axes. **Retryability**: transient (429 / 5xx /
  network / timeout) vs terminal (other 4xx). **Scope**: namespace-global (a property of the
  namespace, so shareable across callers) vs caller-scoped (upstream 401/403 for _this_ caller's
  forwarded identity, or a failure to mint _this_ caller's on-behalf-of token). The combinations
  are all reachable — a mint failure is caller-scoped **and** transient — so neither axis may be
  derived from the other. Classify scope as an **allow-list**: only positively recognized
  namespace-global shapes are shareable, so a statusless failure nobody has classified yet costs
  re-probes rather than replaying one caller's error to another. Every downstream decision keys
  off this classification;
- take a per-kind decode callback (`items[].spec` → typed record) so one client serves every kind.

URL construction: `url.PathEscape` every path segment via one shared
`buildAppPlatformURL(appURL, gv, namespace, resource)`. With every component server-derived there
is nothing to allowlist; host allowlists are for user-controllable URLs (the CDN baseline), not
the fixed internal aggregator.

## 2. Namespace

- Derive the namespace **server-side** from the trusted plugin context:
  `backend.PluginConfigFromContext(r.Context()).Namespace`.
- **Never accept the namespace as a query parameter.** A caller-supplied namespace — even
  charset-validated and `PathEscape`d — is avoidable URL-injection surface, a cross-namespace
  probe, and it makes the cache map attacker-seedable. The trusted value makes all three problems
  vanish. (The front-end already knows its own `config.namespace`; the backend has it too.)

## 3. Caller identity

### Inbound (browser → plugin)

- Fail closed: absent or unverifiable identity → serve no data. Never guess, never fall
  back to `X-Grafana-User` or a numeric id, never use a service account. On GET reads the refusal
  is expressed as the §7 capability envelope (soft-200), not a 401 — "fail closed" constrains
  _what_ is served (nothing), not the status code.
- **Every proxy cryptographically verifies the ID token** before spending an upstream call:
  ES256 signature against the issuing stack's published JWKS, `typ: "jwt"`, and `exp`/`nbf`.
  Structural parsing is **not** sufficient — `X-Grafana-Id` is client-settable in the shapes
  described in the canonical statement below, so an unsigned check accepts a forged `sub` (#1568).
  One shared verifier does this (`pkg/plugin/auth/id_token.go`, over `authlib`); layered on top of
  it, **reject `exp == 0`** — a forwarded Grafana ID token always carries `exp`, and go-jose
  validates expiry only when the claim is present, so an `exp`-less token would otherwise verify
  as non-expiring.
- **Only per-user-data proxies extract `sub`** (verbatim, typed prefix included). A
  namespace-global catalogue proxy needs a verified caller and nothing more; it has no per-user
  need and must not grow one by accident. Ship this as one shared helper with two layers:
  `validIDToken(r)` (everyone) and `subjectFromIDToken(r)` (per-user routes only). Both verify;
  they differ only in whether a `sub` is required.
- Reuse the verifier across requests to share authlib's key cache, but rebuild it against the same
  signing-keys URL at least every five minutes. Authlib otherwise keeps successfully fetched keys
  for the verifier lifetime, which would let a key removed from JWKS remain trusted indefinitely.
- Use the SDK constant `backend.GrafanaUserSignInTokenHeaderName`, never a hardcoded
  `"X-Grafana-Id"` string.
- Missing/invalid identity on a GET read → **soft-200 capability envelope**
  (`reason: "identity-unavailable"`), not 401 (see §7 for why).
- The gate has **three** outcomes, not two, and the transient/structural split of §7 cuts across
  them. Route them from one shared decision (`identityStatus` in
  `pkg/plugin/app_platform_identity.go`) so no route can classify a failure its own way. The
  statuses below are named on the GET-read path; §11 states how the POST-write path serves each:
  - no token, or one the stack will not accept → soft-200 `identity-unavailable`;
  - **no signing-keys URL resolvable at all** (no app URL in the Grafana config, which is also what
    a request carrying no config at all resolves to) → soft-200 `identity-unverifiable`, because
    verification can never succeed on this stack;
  - **the URL resolved but the JWKS fetch failed** (5xx, timeout, refused) → §7's transient
    **503 + `Retry-After`**. This one is retryable, and the front-end caches an empty
    capability=false result without retrying, so an envelope would darken the surface past the
    end of the outage.
- **A write serves the same three statuses in write-path shapes, not soft-200 envelopes**, and the
  standing/transient distinction must survive the translation: rejected → **401** (transient, the
  client retries after re-auth), signing-keys down → **transient 503 + `Retry-After`**, and
  unverifiable → the structural **404** carrying `identity-unverifiable`. Unverifiable must not
  collapse into the 401: it is a standing condition on that stack, and a status the client retries
  would retry every queued write to the 30-day horizon without ever disarming. See §11.

### Outbound (plugin → aggregator)

- Send **one credential: an access token minted for the caller**, on `X-Access-Token`, via the
  shared `pkg/plugin/auth` exchanger so proxies cannot drift.
- **An ID token is not a credential.** It is an identity attestation, and nothing on the outbound
  path accepts one on its own: Grafana's front door only reads an access token from
  `X-Access-Token` (`ExtendedJWT`), and an ID token placed in `Authorization: Bearer` is claimed
  by the API-key client and then fails to decode, so the request 401s at the plugin's own stack
  and never reaches the aggregator. An earlier revision of this section recommended
  `Authorization: Bearer <id-token>` + `X-Grafana-Id` on the strength of a dev-stack smoke that
  had, in fact, only ever been run with a `glsa_` service-account token. Do not reintroduce it.
- The exchange is the same flow `grafana-dbo11y-app` runs in production: exchange the inbound
  `X-Grafana-Id` for an on-behalf-of access token at auth-api, using the CAP token
  stack-state-service provisions into the plugin's `secureJsonData`, then send that. The minted
  token carries the user in its actor claim, so no separate identity header goes with it. The
  instance's embedded aggregator signs the onward hop to GAP itself, which is why the audience is
  the stack's own front door (`grafana`) and not the API group.
- **A stack with no provisioned CAP token is structurally unavailable** (`reason:
"obo-unavailable"`), not a transient failure. A failed exchange, by contrast, is transient: it
  carries no HTTP status, so the shared classifier retries rather than caching a terminal result.
  It is also **caller-scoped** — auth-api can reject one subject token while serving others — so
  it needs its own sentinel error and must never reach a shared negative cache (§1 scope axis).
- **Never forward `Cookie`.** No branch in this repo's history has ever needed it against the
  aggregator; the caller's full session is the broadest possible ambient grant and the classic
  confused-deputy shape.
- **Never replay the inbound `Authorization` header.** Grafana strips it before plugin resource
  handlers, so replaying it forwards an absent header — dead code that reads as load-bearing.

### The identity trust boundary — canonical statement

This subsection is the single authoritative statement for **all** App Platform proxies. Do not
re-argue this trade-off per PR; link here instead. (It previously lived in
`docs/developer/CODA.md`, which was correct only by accident — it moved here when the Coda backend
was extracted into the `grafana-coda-app` plugin and `CODA.md` became a consumer guide.)

The `/completion-records/*` and `/custom-guide-repository` routes authenticate callers by
**cryptographically verifying** the Grafana-forwarded ID token (`X-Grafana-Id`, via the SDK constant
`backend.GrafanaUserSignInTokenHeaderName`) against the stack's own published JWKS at
`GET {appURL}/api/signing-keys/keys` — the unauthenticated endpoint of the same instance that
issued the token (`pkg/plugin/auth/id_token.go`, over `github.com/grafana/authlib`). Verified:
ES256 signature against a `kid` in the live key set, `typ: "jwt"` (an access token must not
authenticate an identity), and `exp`/`nbf` with go-jose's one-minute leeway. `exp` **presence** is
additionally required here, because go-jose validates expiry only when the claim is present and an
`exp`-less token would otherwise verify as non-expiring. The `sub` claim is extracted verbatim
only on routes that serve per-user data (`pkg/plugin/app_platform_identity.go`).

Because the signature is checked, the header's **authenticity** no longer depends on Grafana's
server→plugin forwarding — which matters, since `X-Grafana-Id` is **not** on
`ClearAuthHeadersMiddleware`'s strip-list and `ForwardIDMiddleware` overwrites rather than
deletes, so a client-set value can survive to the plugin whenever the authenticated requester has
no ID token of its own (#1568). Verification proves the token was **issued** by this stack, not
that the caller presenting it is its subject: a copied, still-unexpired token replayed on a
per-user route still verifies. Binding the token to its presenter is tracked separately.

Verification failures always fail **closed**, under the three outcomes listed in the inbound
bullets above, all decided by one shared `identityStatus`
(`pkg/plugin/app_platform_identity.go`) so no route can classify a failure its own way.

Authlib caches fetched keys for the lifetime of one verifier. Pathfinder reuses that verifier for
at most **five minutes**, then rebuilds it against the same signing-keys URL, so steady-state
verification avoids per-request network calls while a key removed from JWKS remains trusted for
no more than five minutes. The **first** request bearing an unknown `kid` triggers an immediate
re-fetch, so a newly published key need not wait for that interval; if the key is still unpublished
at that moment, authlib negative-caches the `kid` and later requests carrying it are rejected
without re-fetching until the rebuild. That re-fetch merges into the current verifier's cached set
rather than replacing it, so it never prunes a retired key and the five-minute rebuild stays the
revocation bound. The fetch itself is detached from the caller's cancellation and
separately deadlined, because authlib dedupes it across concurrent callers with singleflight: one
canceled request would otherwise fail every waiter with a spurious outage.

Outbound, the ID token is **not** forwarded as a credential. It is exchanged for a short-lived
on-behalf-of access token sent on `X-Access-Token`, per the outbound bullets above — never the
caller's `Cookie`, and never a replay of the inbound `Authorization` header.

One deliberate omission: `aud` is not validated, because an ID token's audience is `org:<orgID>`,
which tells a plugin nothing it can act on. This mirrors Grafana's own ExtendedJWT client. Binding
the token's `namespace` claim to the plugin-context namespace is tracked separately and is not
required for the signature to make `sub` unforgeable — though unforgeable is not the same as bound
to the presenter; see the replay caveat above.

## 4. Cache

- In-process, **keyed by the trusted-context namespace**. Once §2 holds, the key space is one
  entry per process on hosted Grafana, so the map needs no eviction — **say so in a comment**
  rather than leaving it implicit. (A cheap max-entries guard is acceptable belt-and-braces but
  not required; the real fix is removing the caller-controlled key.)
- **Every request — cache hit or miss — passes the §3 inbound identity gate first.** Warm bytes
  are never served to an unauthenticated caller.
- **Per-user data ⇒ identity-partitioned cache** (`byUser map[sub] → slice`, serve
  `idx.byUser[userID]` only): a cache hit must be structurally incapable of exposing another
  user's slice.
- **Shared-blob data ⇒ prove and document identity-invariance.** Authorization is enforced at
  cache-fill and shared for the TTL — state this in a comment. It is only sound if the upstream
  LIST returns the same result for every authorized caller in the namespace; otherwise one
  caller's richer RBAC view leaks to everyone for a TTL window. The invariance claim must be
  written down, not assumed.
- **Caller-scoped failures never enter the shared cache.** An upstream 401/403 for caller A's
  token — or a failure to mint caller A's on-behalf-of token — must not become a cached error
  served to caller B. Only failures positively classified as namespace-global on the §1 scope axis
  are shareable; every other failure, transient or terminal, is a per-request response.
- Cache the **shaped/collated result, not raw records**, so steady-state memory is bounded by the
  meaningful entity count; the §1 aggregate budget bounds the transient build footprint.
- TTL by data volatility (5 min for slowly-changing per-user records; 30 s for an
  edited-in-place catalogue) — document the rationale next to each constant.
- Optional `?refresh=1` bypass when the front-end writes and immediately re-reads;
  **rate-limited server-side** (~30 s/namespace) so it cannot become a load lever.
- Single-flight concurrent refreshes per namespace (`done`-channel pattern); waiters honor their
  own `ctx.Done`; the fetch detaches with `context.WithoutCancel` **bounded by the §1 aggregate
  deadline**.

## 5. Failure semantics (availability-first)

The baseline's model — error cached sticky for the full 6 h TTL, no stale-serve
(`package_recommendations.go`) — is explicitly **rejected** for this shape:

- **Warm cache + upstream failure → serve stale** at 200, with the envelope's `asOf` telling the
  truth about age. Never overwrite last-good data with an error entry.
- **Cold cache + transient failure → 503 + `Retry-After`.**
- **Cold cache + terminal failure → soft-200 capability envelope** ("this will not fix itself by
  retrying"), not a 503.
- **Negative-cache cooldown** (~30 s), a _separate constant_ from the success TTL: single-flight
  only collapses concurrent requests; the cooldown is what protects a struggling upstream from
  the sequential stream.

## 6. Response envelope

- Self-describing JSON, camelCase: the data array (always `[]`, never `null`), **`asOf`** (when
  the underlying LIST completed — the staleness contract), and the §7 capability object where the
  route has structural failure modes.
- Failure envelope is `{"error": "<stable-machine-token>"}` via the shared `writeError` in
  `resources.go` — a token like `completion-records-unavailable`, not a human sentence. Plain
  `http.Error` only for 405.
- Additive evolution only; agree any envelope change with every consumer. These envelopes are
  forward contracts — downstream PRs bind to them and they ossify immediately.
- Every envelope is described twice, in two languages, across a process boundary, so it carries
  **contract goldens** — see §10.

## 7. Availability signaling

- Three states the front-end genuinely needs to distinguish: **available**, **structurally
  unavailable on this stack** (toggle off / identity not forwarded / no signing keys resolvable /
  terminal upstream), and **transient hiccup** (including an unreachable JWKS — see §3).
- Structural unavailability is signaled **in-band**: HTTP 200 with
  `capability: { available: false, reason: "<machine-token>" }`. Split the token by cause rather
  than lumping — the custom-guide route distinguishes missing identity, toggle off, no app URL, no
  namespace, no provisioned on-behalf-of credential, and `upstream-<status>` for a terminal
  upstream, so the envelope alone is diagnosable without backend log access; the completion
  routes still collapse the config causes into the catch-all `backend-unavailable`, while keeping
  identity itself split into `identity-unavailable` (no acceptable caller token) and
  `identity-unverifiable` (this stack can never check one — §3). The `reason*`
  constants in `pkg/plugin/` are the definition, and the front-end gates on `available` and
  ignores the string.
  A bare 503 conflates "never works here" with "blip": the front-end already lumps 503 into its
  not-rolled-out status set (`UNAVAILABLE_STATUSES` in `src/utils/fetchBackendGuides.ts`, mirrored
  in `src/context-engine/context.init.ts`) and silently renders empty with no retry, so a
  transient 503 darkens the feature for that load exactly as if it were structurally absent. This
  is also why missing identity on a GET read is soft-200, not 401: these routes gate whether a
  feature renders at all.
- **"Unavailable" ≠ "empty result."** `{items: []}` must mean the user genuinely has none.
- A capability probe route makes the same transient/terminal distinction as the data route — a
  probe that flips `false` during a 30-second blip greys out UI for everyone.
- Name capability fields for what they measure. A read-derived signal must not promise write
  capability; decide the read-vs-write semantics before any consumer binds.

## 8. Shared plumbing (drift control — extract, don't copy)

One definition each, package-wide:

- the aggregation feature-toggle name — one Go constant per served group, never a scattered
  literal: `completionRecordsAggregationToggle`
  (`aggregation.pathfinderbackend-ext-grafana-app.enabled`, and `customGuideAggregationToggle` is
  the same derived value — both surfaces are served on the `.app` group) and the older
  `pathfinderBackendAggregationToggle` (`…-grafana-com.enabled`). The `.app` names derive from
  `appPlatformGroup` via `aggregationToggle` so they cannot drift from the group; the legacy `.com`
  literal is the named counterpart that pins that derivation. Note what the toggle does and
  does not tell you: it reports that an aggregation layer is served, so a real stack can (and
  does) report **both** true at once. It is a precondition, not the availability answer — route
  availability is whatever the capability/resolver path returns, which additionally requires an
  app URL, a namespace, and a provisioned on-behalf-of credential;
- the identity helpers (§3): `validIDToken`, `subjectFromIDToken`, the `identityStatus` that
  decides how each failure is served, the shared `IDTokenVerifier`, and the `pkg/plugin/auth`
  token exchanger every proxy authenticates with;
- the paginated LIST client + `buildAppPlatformURL` (§1);
- the single-flight + cache scaffolding (done-channel, `WithoutCancel`, per-namespace map);
- the existing `timeNow` seam (`package_recommendations.go`) — **all** time reads go through it:
  TTL, cooldown, rate limits, token expiry. Direct `time.Now()` makes expiry logic untestable,
  and the missing tests that follow are exactly where latent bugs hide.

## 9. Observability

- Expected-ish upstream unavailability logs at `Debug`/`Info` (not `Warn` per hit); log
  stale-serve and cooldown **transitions** once, not per request.
- Emit cache vital signs (refresh/failure counts, stale-serves, hit/miss, page/record counts) as
  metrics or structured logs — a cache without them is undiagnosable on-call, and index-size
  visibility is the early warning before a memory ceiling.
- **First-request credential diagnostics:** on the first upstream LIST, log the response status
  and which outbound credential was sent — the header **name** plus a redaction placeholder,
  never the token or any part of it. Name the field for what it carries (`outboundCredential`):
  a key that calls a bearer credential an identity header is the same category error that made
  this proxy 401 everywhere, and it invites the next reader to treat a real credential as
  non-sensitive. The most likely production incident for this shape is "the credential model
  doesn't authenticate on a real stack" — this log turns that from a mystery into a one-line
  diagnosis.

## 10. Testing

- Mocked-client unit tests cover: pagination draining (multi-page continue tokens), TTL expiry
  (deterministic via `timeNow`), single-flight, refresh rate limit, identity fail-closed
  **including `exp == 0` rejection**, cross-user isolation where data is per-user, the failure
  matrix (cold-transient, cold-terminal, warm-stale, cooldown, and caller-scoped-not-shared for
  both 401/403 and a failed token mint), and the config-resolution branch (toggle off / no app
  URL) — don't let a test-only override short-circuit the structural-unavailability path out of
  existence.
- Mocked tests cannot prove the live credential path. Every PR of this shape carries a **runtime
  smoke procedure** in its body (create a resource upstream, hit the route, see it shaped) and
  treats that smoke as a **gate before dependent work binds to the route** — doubly so where the
  outbound header set itself (§3) is smoke-dependent.

### Contract goldens (Go ⇄ TypeScript)

A new route's envelope is described twice — once in `pkg/plugin`, once in the client that consumes
it — in two processes, so no compiler couples them. Two committed golden families do:

- **Value goldens** captured from the real handler over `httptest`, in
  `pkg/plugin/testdata/contract/<envelope-key>.<variant>.json`. Never marshalled from a hand-built
  struct value: that cannot catch a handler that stops emitting a field its struct still declares.
- **A reflected tag golden**, `struct-tags.json`, inventorying every reachable struct's json names,
  types, normalized JSON wire types, and `omitempty` flags. The TypeScript test derives the same
  normalized descriptors from Zod and compares every field, so regenerating cannot bless a type
  widening whose existing fixture values still fit the old schema. Load-bearing, not
  belt-and-braces: no fixture populates a
  brand-new `omitempty` field, so a struct that _gains_ one leaves every value golden byte-identical
  and both sides green while the frontend never learns the field exists.

`pkg/plugin/contract_fixtures_test.go` writes both; `src/validation/backend-api-contract.test.ts`
reads both and holds them against the Zod schemas in `src/types/backend-api.schema.ts`, so a Go
change surfaces as a TypeScript failure that names the field. Those schemas track **wire truth**,
not what the client interface wishes were on the wire.

Adding a route means adding an envelope to `contractRoots()` plus at least one capture case, and a
schema registered in `GO_STRUCT_SCHEMAS` / `BACKEND_RESPONSE_ENVELOPES`; the tests fail if either
half is missing. Regenerate after an intentional change:

```bash
go test ./pkg/plugin -run TestContract -update
```

## 11. The write variant (POST create)

The read shape above is a GET LIST proxy; the same aggregator kind also needs a **POST create**
proxy (`pkg/plugin/completion_records_write.go`, epic
[#1411](https://github.com/grafana/grafana-pathfinder-app/issues/1411)), which routes writes through
plugin-backend so authoritative identity is stamped server-side. Authorization is delegated to App
Platform RBAC on the caller's own forwarded identity — the proxy adds no privilege. On the served
`.app` group the basic viewer role grants write on `CompletionRecord` (verified 2026-07-24 with a
real Viewer user via a **direct** App Platform write — POST → 201, RBAC enforced — NOT through the
deployed plugin proxy), so the proxy exists not to lend privilege but for
what a direct client write does not do for us: server-stamp identity/org/stack fields (the CRD
validates field presence, not truth), enforce a per-user rate limit, invalidate the read cache on
create, and classify failures into the transient/terminal taxonomy the front-end queue consumes.
**Trust model (today):** because a Viewer can create the same CRD directly, these are
**lightweight self-reported records, not attested facts** — the server stamping is a best-effort
convenience, not an enforced identity boundary. That is a **current, time-bounded limitation, not
a permanent design property**: closing the forgery gap with a platform-side operator is under
active discussion with the App Platform team, and this paragraph should be revisited when that
lands. Until then, do not describe these records as enforced attribution — and do not describe the
gap as unfixable. The residual merge gate
is a live Viewer-attributed write through the _deployed_ plugin proxy — proving the proxy's identity
forwarding end-to-end, not the RBAC layer, which is now cleared. The proxy reuses the read
shape's shared machinery — the URL builder (§1), trusted-context namespace (§2), the identity
helpers and the JWKS-verified trust boundary (§3), and the in-process cache (§4) — and diverges only
where a create differs from a read:

- **Identity/org/stack are stamped server-side**, never trusted from the body. The typed request
  struct carries only client facts (guide id/source/title, category, `pathId`, `completedAt`,
  duration, `completionPercent`, `platform`), so any identity a client smuggles in is dropped on
  decode; `userId` (from the ID-token
  `sub`), `userLogin`, `userDisplayName`, `orgId`, `stackNamespace`, `recordedAt`, and `schemaVersion`
  come from the verified request context. `userLogin`/`userDisplayName` are best-effort **display
  snapshots** read from the signed ID token's `username`/`name` claims (Grafana authlib
  `IDTokenClaims` — not `login`/`preferred_username`, which Grafana does not emit). There is
  **no fallback**: an absent claim omits the field rather than substituting `PluginContext.User`,
  the `X-Grafana-User` header, or anything else, and the write still succeeds (the omission is
  logged). A plausible-but-unverified login is worse than an absent one because it reads as
  verified, and these records are headed for compliance-grade use — absence is auditable, a
  forgery is not. They gate nothing and the read path joins exclusively
  on `userId`, so an absent claim yielding an empty snapshot is acceptable. The inbound gate (§3)
  still applies, but a write **fails closed with a status, not the read path's soft-200** — and the
  three failing statuses are not interchangeable, because the status IS the client's retry
  instruction. A **rejected** token is the **401**: the client retries it as transient, since an
  expired session or forwarded token recovers after re-auth. A **signing-keys outage** is the
  transient **503 + `Retry-After`**: a retryable outage, not a verdict on the caller. An
  **unverifiable** stack — no app URL, so no signing keys to check any token against — is the
  structural **404** carrying `identity-unverifiable`, because verification can never succeed there;
  served as a 401 it would retry every queued write to the 30-day horizon and never disarm, whereas
  the 404 disarms the session and RETAINS the records, re-arming on a later app load so a stack that
  gains an app URL starts recording then.
- **`metadata.name` is server-derived, deterministic, and identity-scoped.** A non-blank
  `idempotencyKey` (the completion event's stable client id, #1434) is **required** — a blank or
  missing key is a terminal 400, never a random-name fallback. The name is a DNS-safe
  `hash(userId || sep || key)` over the trusted server-stamped `userId` and the exact key, so a
  retried POST targets the same object and an upstream **409 "already exists" is an idempotent
  success**, not a duplicate or a failure. Scoping the name to `userId` means two callers submitting
  the same key hit **different** objects, so one caller's key can never collide with — or be
  acknowledged against — another's record in the shared namespace. The contract is
  **first-write-wins per `(userId, key)`**: the key must be stable per completion event (which is
  what #1434 sends), so reusing a key for different content resolves to the first record for that
  key. Client-supplied names are never accepted.
- **Client fact fields are validated against the CRD's value domains** (source, category, and
  platform enums; `completionPercent` bounds; per-field byte caps, a UTF-8 validity check, and a
  control-character reject on the free-text fields; `durationMs` CLAMPED into `[0, 24h]` when out of
  range — an out-of-range value is a producer bug in one denormalized convenience field, and
  clamping it visibly, with a log line, beats discarding a completion the user really earned) and `completedAt` is bounded to
  a sane window
  (`[now − 30d, now + 5m]`) to tolerate delayed offline/queued retries while rejecting gross
  backdating; any violation is a terminal 400. The **30-day backdating horizon is the durability
  boundary of the whole feature**: a completion queued offline longer than 30 days is deterministically
  dropped on its eventual retry, so the front-end queue must expire (and surface) items at the same
  30-day bound rather than retrying a write the backend will reject.
- **A per-user token-bucket write rate limit** (`completion_records_write_ratelimit.go`, §9 flood
  guard) runs before any upstream work; exhaustion returns 429 with `Retry-After`.
- **A successful create stales the namespace read cache** (§4), advances its generation, and
  clears the negative-cache cooldown (a create is fresh proof the upstream is reachable). The
  cached index is marked stale rather than deleted: staling is what skips the TTL fast path and
  forces the refresh, while KEEPING the warm index as §7's stale-serve fallback, so a failed
  post-write refresh still serves a slightly-stale 200 instead of a cold 503.
  Any LIST that began before the write may finish for its caller but cannot repopulate that cache;
  a post-write GET starts a new refresh.
- **Outcomes map onto the front-end retry-queue contract — four outcomes (created, retry,
  disarm-and-keep, drop) across five status classes:** 201 created (durable);
  **404 preserved verbatim** as the structural "route not deployed here" signal — the create POSTs
  to the completionrecords **collection**, so an upstream 404 means the whole group/route is absent
  (never a per-record miss). The client disarms writes for the session (persisted items survive for
  the next load); the 404 is never a per-record drop and is never remapped to another status. There
  are **three** ways into that 404: an upstream 404, a stack with no provisioned on-behalf-of
  credential (`obo-unavailable`), and an inbound identity this stack can never verify
  (`identity-unverifiable`, §3) — all three are "never works here" on this load, and all three keep
  the queued records.
  The full status/outcome table: **201** created (durable); **401** transient — echoed verbatim and
  retried client-side after re-auth (an expired session/token recovers), the one 4xx that is not a
  drop; **404** structural disarm/keep (upstream 404, `obo-unavailable`, or
  `identity-unverifiable`); **408 / 429 / 5xx / 3xx / network / token-exchange failure**
  transient; **403** disarm/keep —
  echoed verbatim; like 404 the client disarms writes for the session and RETAINS the queued
  records for a later drain, because a missing grant can be added without the completion ever
  happening again. It is logged at a Faro-visible level (warn), since a systemic RBAC/grant-rollout
  denial will not fix itself by retrying; **all other
  4xx** terminal (validation / schema — the client drops it). On the transient path the
  client retries with capped exponential backoff — the proxy sets `Retry-After` as a standard hint,
  but Grafana's `backendSrv` strips response headers from its thrown `FetchError`, so the front-end
  client cannot honor it. Redirects are never followed on an
  authenticated call: the outbound credential is now a **minted on-behalf-of access token** — a
  live bearer credential, strictly worse to leak than an identity attestation — and Go does not
  classify the custom `X-Access-Token` header as sensitive, so a followed cross-origin 3xx would
  hand it (and, on 307/308, the POST body) to the redirect target. The App Platform create accepts
  only 200/201, and any other 2xx or 3xx is
  treated as an invalid upstream response and mapped to a retryable 502. The same idempotency key is
  sent on every retry, so a committed-but-unacknowledged write resolves to a 409 idempotent success.
- **Credential availability is structural, exchange failure is not.** The write resolver gates on a
  provisioned on-behalf-of exchanger exactly as the read resolver does: absent → `obo-unavailable`
  → 404 → the client disarms the session and keeps its queued facts. A _failed exchange_ on a
  provisioned stack is the opposite case — an auth-api blip that recovers — so it carries no HTTP
  status and rides the existing transient path. It is logged at **warn** (Faro-visible), because
  the one bad shape here, a provisioned credential whose environment is missing its
  delegated-permissions grant, would otherwise retry silently until the 30-day retention horizon.

**Store cutover (`.com` → `.app`).** Completion records read and write exclusively on the `.app`
group; `main` previously read the legacy `.com` group. The backend owner **confirmed the legacy
`.com` CompletionRecord store empty (2026-07-30)**, so this is a **hard cut with no migration and no
dual-read**. Reversibility is asymmetric: once `.app` writes land, a plain revert to the `.com`
reader would orphan the new records, so **keep the `.app` reader if the POST route is ever backed
out** — remove the write, not the read.

---

## Author's checklist

- [ ] Shared paginated LIST client; drains `continue`; per-page + aggregate deadlines; per-page
      byte cap + aggregate budget with logged truncation
- [ ] Namespace from `PluginConfigFromContext().Namespace` — never a query param
- [ ] Inbound: JWKS signature verification everywhere via the shared verifier (plus `exp` present);
      `sub` extraction only where data is per-user; fail closed, with the three §3 outcomes routed
      from the one shared `identityStatus`
- [ ] Rebuild the verifier at least every 5 min; same-URL rotation tests prove a removed key is
      rejected and a newly published key is accepted after refresh
- [ ] Outbound: shared identity-forwarding helper; ID-token-derived headers only; never `Cookie`;
      never replay inbound `Authorization`
- [ ] Per-user data ⇒ identity-partitioned cache; shared blob ⇒ identity-invariance proven &
      documented; caller-scoped failures never cached shared
- [ ] "Auth enforced at cache-fill, shared for TTL" comment present; no-eviction invariant
      commented
- [ ] Stale-serve on warm failure; 503+`Retry-After` cold-transient; capability envelope
      cold-terminal; negative-cache cooldown as a separate constant
- [ ] Envelope: `[]` never `null`; `asOf`; in-band capability; stable machine error tokens;
      "empty ≠ unavailable"
- [ ] Contract goldens: envelope in `contractRoots()`, ≥1 `httptest` capture case, Zod schema
      registered — value goldens _and_ the reflected tag golden
- [ ] One toggle const; SDK header constant; `timeNow` seam everywhere
- [ ] Debug-level upstream logs; cache metrics; first-request credential diagnostics
- [ ] Tests: pagination, TTL expiry, ID-token rejection matrix (forged signature, unknown `kid`,
      wrong `typ`, `exp == 0`, expired), signing-keys-unavailable fails closed, isolation, failure
      matrix, config branch
- [ ] Runtime smoke procedure in the PR body, gating dependent work and the final outbound header
      set

---

## Appendix: conformance gaps in #1398 and #1400 as reviewed (2026-07-22)

Delete this section once both PRs conform. Line references are to the PR diffs at review time.

### PR #1400 (custom guide catalogue) — larger delta

- Namespace from trusted context; delete `?namespace=` + `isValidNamespace` (§2)
- Verify the ID token via the shared helper; fail closed before the upstream call
  (§3) — today the token is forwarded verbatim with only a presence check
- Outbound: mint an on-behalf-of access token from the inbound ID token and send it on
  `X-Access-Token` via the shared `pkg/plugin/auth` exchanger (§3). Forwarding the ID token in any
  header slot does not authenticate against the aggregator on a real stack. Both PRs must
  terminate at the same exchanger
- Missing/invalid identity → soft-200 `identity-unavailable` capability envelope, not 401 (§7);
  a failed signing-keys fetch takes the transient 503 path instead (§3)
- Paginate (`limit` + `continue`) + aggregate budget + aggregate deadline (§1) — today a single
  request ignores `metadata.continue` entirely
- Transient/terminal taxonomy + `Retry-After` — the fetcher already distinguishes 401/403 from
  other non-200s internally but discards the distinction into a flat 503 (§5)
- Separate failure cooldown + stale-serve; stop unconditionally overwriting last-good data with
  error entries; caller-scoped failures never cached shared (§4, §5)
- `timeNow` seam + TTL-expiry test (§8, §10)
- Stable machine error token; add `asOf` (§6)
- Document the shared-blob identity-invariance claim at the cache (§4)

### PR #1398 (completion records) — smaller delta

- Outbound headers: drop `Cookie`; drop the verbatim `Authorization` replay (Grafana strips the
  inbound header, so it forwards nothing) and send only an access token minted from `X-Grafana-Id`
  on `X-Access-Token`, via the shared `pkg/plugin/auth` exchanger (§3)
- Reject `exp == 0` in `subjectFromIDToken`; the `typed prefix preserved verbatim` case in
  `completion_identity_test.go` builds its token with no `exp` claim and asserts success — give
  it a real `exp` and add an explicit missing-`exp` rejection case (§3, §10)
- Aggregate budget across pages + aggregate deadline bounding the detached drain — today the
  8 MiB cap is per-page with unbounded page count, and the `WithoutCancel` drain has no overall
  deadline (§1)
- Comment the no-eviction invariant on the namespace map (§4)

### Both

- Extract shared plumbing: identity helpers, toggle constant, paginated LIST client, URL builder,
  single-flight/cache scaffolding (§8)
- Document the ID-token trust boundary once, identically — it lives in §3 of this document; since
  #1568 that boundary is authlib/JWKS signature verification, not a structural check (§3)
- First-request credential diagnostics log (§9)
- Runtime smoke procedure in the PR body, gating dependent work and the final outbound header set
  (§3, §10)
