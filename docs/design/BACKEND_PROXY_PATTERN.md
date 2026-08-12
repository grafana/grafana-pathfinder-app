# Backend App Platform proxy pattern

**Scope:** plugin-backend (`pkg/plugin/`) routes that proxy a paginated App Platform CRUD
endpoint served by the pathfinder-backend aggregator (`pathfinderbackend.ext.grafana.com/v1alpha1`).

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
  `pkg/plugin/app_platform_identity.go`) so no route can classify a failure its own way:
  - no token, or one the stack will not accept → soft-200 `identity-unavailable`;
  - **no signing-keys URL resolvable at all** (no Grafana config, no app URL) → soft-200
    `identity-unverifiable`, because verification can never succeed on this stack;
  - **the URL resolved but the JWKS fetch failed** (5xx, timeout, refused) → §7's transient
    **503 + `Retry-After`**. This one is retryable, and the front-end caches an empty
    capability=false result without retrying, so an envelope would darken the surface past the
    end of the outage.

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

Because the signature is checked, none of this depends on Grafana's server→plugin forwarding to
keep the header honest — which matters, since `X-Grafana-Id` is **not** on
`ClearAuthHeadersMiddleware`'s strip-list and `ForwardIDMiddleware` overwrites rather than
deletes, so a client-set value can survive to the plugin whenever the authenticated requester has
no ID token of its own (#1568).

Verification failures always fail **closed**, under the three outcomes listed in the inbound
bullets above, all decided by one shared `identityStatus`
(`pkg/plugin/app_platform_identity.go`) so no route can classify a failure its own way.

Authlib caches fetched keys for the lifetime of one verifier. Pathfinder reuses that verifier for
at most **five minutes**, then rebuilds it against the same signing-keys URL, so steady-state
verification avoids per-request network calls while a key removed from JWKS remains trusted for
no more than five minutes. Unknown `kid`s still trigger authlib's immediate re-fetch, so a newly
published key need not wait for that interval; that re-fetch merges into the current verifier's
cached set rather than replacing it, so it never prunes a retired key and the five-minute rebuild
stays the revocation bound. The fetch itself is detached from the caller's cancellation and
separately deadlined, because authlib dedupes it across concurrent callers with singleflight: one
canceled request would otherwise fail every waiter with a spurious outage.

Outbound, the ID token is **not** forwarded as a credential. It is exchanged for a short-lived
on-behalf-of access token sent on `X-Access-Token`, per the outbound bullets above — never the
caller's `Cookie`, and never a replay of the inbound `Authorization` header.

One deliberate omission: `aud` is not validated, because an ID token's audience is `org:<orgID>`,
which tells a plugin nothing it can act on. This mirrors Grafana's own ExtendedJWT client. Binding
the token's `namespace` claim to the plugin-context namespace is tracked separately and is not
required for the signature to make `sub` unforgeable.

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
  `capability: { available: false, reason: "identity-unavailable" | "identity-unverifiable" |
"backend-unavailable" }`.
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

- the aggregation feature-toggle names — one Go constant per group, already extracted:
  `pathfinderBackendAggregationToggle` (`pkg/plugin/app_platform_client.go`) for the legacy `.com`
  group, and `customGuideAggregationToggle` (`pkg/plugin/custom_guide_repository_client.go`) for
  the GAP `.app` group. Two constants with the same string is a rename bug waiting;
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
  and which identity headers were present. The most likely production incident for this shape is
  "the credential model doesn't authenticate on a real stack" — this log turns that from a
  mystery into a one-line diagnosis.

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

- Outbound headers: drop `Cookie`; replace the verbatim `Authorization` replay (Grafana strips
  the inbound header, so it forwards nothing) with `Bearer <id-token>` derived from
  `X-Grafana-Id` — the runtime-verified shape — via the shared helper (§3)
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
