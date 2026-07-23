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
- classify errors once — **transient** (429 / 5xx / network / timeout) vs **terminal** (other
  4xx) — and flag whether the failure was **identity-scoped** (upstream 401/403 for _this_
  caller's forwarded identity). Every downstream decision keys off this classification;
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

- Fail closed: absent or structurally invalid identity → serve no data. Never guess, never fall
  back to `X-Grafana-User` or a numeric id, never use a service account. On GET reads the refusal
  is expressed as the §7 capability envelope (soft-200), not a 401 — "fail closed" constrains
  _what_ is served (nothing), not the status code.
- **Every proxy structurally validates the ID token** before spending an upstream call:
  well-formed JWT, `exp` **present and** unexpired. **Reject `exp == 0`** — a forwarded Grafana
  ID token always carries `exp`, and accepting its absence weakens the one structural check we
  have.
- **Only per-user-data proxies extract `sub`** (verbatim, typed prefix included). A
  namespace-global catalogue proxy validates structure and forwards; it has no per-user need and
  must not grow one by accident. Ship this as one shared helper with two layers:
  `validIDToken(r)` (everyone) and `subjectFromIDToken(r)` (per-user routes only).
- Use the SDK constant `backend.GrafanaUserSignInTokenHeaderName`, never a hardcoded
  `"X-Grafana-Id"` string.
- Missing/invalid identity on a GET read → **soft-200 capability envelope**
  (`reason: "identity-unavailable"`), not 401 (see §7 for why).

### Outbound (plugin → aggregator)

- Forward **identity derived from the ID token only**, via ONE shared
  `forwardIdentityHeaders(dst, token)` helper so proxies cannot drift.
- The only runtime-verified configuration (dev-stack smoke, commit `89d6bd5e` on
  `feat/external-import-api`) is `Authorization: Bearer <id-token>` **+** `X-Grafana-Id`, both
  synthesized from the inbound ID token, with the `idForwarding` toggle on (standard on Cloud).
  That evidence is from the sibling guides-import proxy — same aggregator, different kind — not
  from these routes themselves; extrapolating is reasonable, but each new proxy confirms the
  header set via its own §10 runtime smoke. Start with both headers; if a live smoke proves
  `X-Grafana-Id` alone suffices, narrow to that and record it.
- **Never forward `Cookie`.** No branch in this repo's history has ever needed it against the
  aggregator; the caller's full session is the broadest possible ambient grant and the classic
  confused-deputy shape.
- **Never replay the inbound `Authorization` header.** Grafana strips it before plugin resource
  handlers (verified on a dev stack: every Editor call returned 502 "authorization header
  missing" until the ID-token switch), so replaying it forwards an absent header — dead code that
  reads as load-bearing.
- Write down the trust assumption **once**, in `docs/developer/CODA.md`, identically for all
  proxies: structural (non-signature) JWT validation is defensible _only_ because requests reach
  the plugin exclusively via Grafana's trusted server→plugin forwarding, and the plugin backend
  is not independently reachable with a client-set `X-Grafana-Id`. Name JWKS verification via
  `github.com/grafana/authlib` as the single future-hardening item; do not re-argue it per PR.

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
- **Identity-scoped failures never enter the shared cache.** An upstream 401/403 for caller A's
  token must not become a cached error served to caller B. Terminal identity failures are
  per-request responses.
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

## 7. Availability signaling

- Three states the front-end genuinely needs to distinguish: **available**, **structurally
  unavailable on this stack** (toggle off / identity not forwarded / terminal upstream), and
  **transient hiccup**.
- Structural unavailability is signaled **in-band**: HTTP 200 with
  `capability: { available: false, reason: "identity-unavailable" | "backend-unavailable" }`.
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

- the aggregation feature-toggle name — no Go constant exists on main today; the string
  `aggregation.pathfinderbackend-ext-grafana-com.enabled` lives only as scattered literals. Two
  constants with the same string is a rename bug waiting;
- the identity helpers (§3): `validIDToken`, `subjectFromIDToken`, `forwardIdentityHeaders`;
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
  matrix (cold-transient, cold-terminal, warm-stale, cooldown, identity-scoped-not-shared), and
  the config-resolution branch (toggle off / no app URL) — don't let a test-only override
  short-circuit the structural-unavailability path out of existence.
- Mocked tests cannot prove the live credential path. Every PR of this shape carries a **runtime
  smoke procedure** in its body (create a resource upstream, hit the route, see it shaped) and
  treats that smoke as a **gate before dependent work binds to the route** — doubly so where the
  outbound header set itself (§3) is smoke-dependent.

## 11. The write variant (POST create)

The read shape above is a GET LIST proxy; the same aggregator kind also needs a **POST create**
proxy (`pkg/plugin/completion_records_write.go`, epic
[#1411](https://github.com/grafana/grafana-pathfinder-app/issues/1411)), which routes writes through
plugin-backend so authoritative identity is stamped server-side. Authorization is delegated to App
Platform RBAC on the caller's own forwarded identity — the proxy adds no privilege. **Interim
reality:** a live RBAC probe (2026-07-23) showed Viewer tokens are rejected (403) on direct
aggregated-API creates while their reads succeed; because the proxy forwards the same Viewer
identity, Viewer completions currently fail terminal upstream and are dropped by the client. Live
Viewer attribution is a tracked merge gate for un-darking, and its resolution must not regress to
a service-account write credential (§3). The proxy reuses the read
shape's shared machinery — the URL builder (§1), trusted-context namespace (§2), the identity
helpers and unsigned-JWT trust boundary (§3), and the in-process cache (§4) — and diverges only
where a create differs from a read:

- **Identity/org/stack are stamped server-side**, never trusted from the body. The typed request
  struct carries only client facts (guide id/source/title, category, `pathId`, `completedAt`,
  duration, `completionPercent`, `platform`), so any identity a client smuggles in is dropped on
  decode; `userId` (from the ID-token
  `sub`), `userLogin`, `userDisplayName`, `orgId`, `stackNamespace`, `recordedAt`, and `schemaVersion`
  come from the verified request context. `userLogin`/`userDisplayName` are best-effort **display
  snapshots** (ID-token claims, then the `X-Grafana-User` header) — a documented exception to §3's
  no-`X-Grafana-User` rule that is acceptable only because they gate nothing and the read path
  joins exclusively on `userId`. The inbound gate (§3) still applies, but a write **fails
  closed with a 401**, not the read path's soft-200; the client retries 401s as transient, since
  an expired session or forwarded token recovers after re-auth.
- **`metadata.name` is server-generated** (random, DNS-safe) per create. Client-supplied names are
  not accepted and there is **no 409 idempotency by design** — every accepted POST is a new record.
  Delivery is therefore **at-least-once** (a retry after an upstream success that failed to report
  mints a duplicate); duplicates are absorbed by the read path's per-`(userId, guideSource,
guideId)` collation.
- **Client fact fields are validated against the CRD's value domains** (source, category, and
  platform enums; `completionPercent` bounds; per-field byte caps and a control-character reject on
  the free-text fields) and `completedAt` is bounded to a sane window
  (`[now − 30d, now + 5m]`) to tolerate delayed offline/queued retries while rejecting gross
  backdating; any violation is a terminal 400.
- **A per-user token-bucket write rate limit** (`completion_records_write_ratelimit.go`, §9 flood
  guard) runs before any upstream work; exhaustion returns 429 with `Retry-After`.
- **A successful create invalidates the namespace read cache** (§4), advances its generation, and
  clears the negative-cache cooldown (a create is fresh proof the upstream is reachable).
  Any LIST that began before the write may finish for its caller but cannot repopulate that cache;
  a post-write GET starts a new refresh.
- **Outcomes map onto the front-end retry-queue contract (four-way):** 201 created (durable);
  **404 reserved** for the structural "route not deployed here" signal — the client disarms writes
  for the session (persisted items survive for the next load), so an upstream per-record 404 is
  remapped to 422; other non-429 4xx
  terminal (validation / auth / schema — the client drops it); 429 / 5xx / network transient (the
  client retries with capped exponential backoff — the proxy sets `Retry-After` as a standard
  hint, but Grafana's `backendSrv` strips response headers from its thrown `FetchError`, so the
  front-end client cannot honor it). The App Platform create accepts only
  200/201; any other 2xx is treated as an invalid upstream response and mapped to a retryable 502.

---

## Author's checklist

- [ ] Shared paginated LIST client; drains `continue`; per-page + aggregate deadlines; per-page
      byte cap + aggregate budget with logged truncation
- [ ] Namespace from `PluginConfigFromContext().Namespace` — never a query param
- [ ] Inbound: structural JWT validation everywhere (`exp` present + unexpired); `sub` extraction
      only where data is per-user; fail closed
- [ ] Outbound: shared identity-forwarding helper; ID-token-derived headers only; never `Cookie`;
      never replay inbound `Authorization`
- [ ] Per-user data ⇒ identity-partitioned cache; shared blob ⇒ identity-invariance proven &
      documented; identity-scoped failures never cached shared
- [ ] "Auth enforced at cache-fill, shared for TTL" comment present; no-eviction invariant
      commented
- [ ] Stale-serve on warm failure; 503+`Retry-After` cold-transient; capability envelope
      cold-terminal; negative-cache cooldown as a separate constant
- [ ] Envelope: `[]` never `null`; `asOf`; in-band capability; stable machine error tokens;
      "empty ≠ unavailable"
- [ ] One toggle const; SDK header constant; `timeNow` seam everywhere
- [ ] Debug-level upstream logs; cache metrics; first-request credential diagnostics
- [ ] Tests: pagination, TTL expiry, `exp == 0` rejection, isolation, failure matrix, config
      branch
- [ ] Runtime smoke procedure in the PR body, gating dependent work and the final outbound header
      set

---

## Appendix: conformance gaps in #1398 and #1400 as reviewed (2026-07-22)

Delete this section once both PRs conform. Line references are to the PR diffs at review time.

### PR #1400 (custom guide catalogue) — larger delta

- Namespace from trusted context; delete `?namespace=` + `isValidNamespace` (§2)
- Structurally validate the ID token via the shared helper; fail closed before the upstream call
  (§3) — today the token is forwarded verbatim with only a presence check
- Outbound: add `Authorization: Bearer <id-token>` alongside `X-Grafana-Id` via the shared
  `forwardIdentityHeaders` helper (§3) — today it sends `X-Grafana-Id` only
  (`custom_guide_repository.go:285`), half the runtime-verified shape, and may not authenticate
  against the aggregator on a real stack. Both PRs must terminate at the same helper output
- Missing/invalid identity → soft-200 `identity-unavailable` capability envelope, not 401 (§7)
- Paginate (`limit` + `continue`) + aggregate budget + aggregate deadline (§1) — today a single
  request ignores `metadata.continue` entirely
- Transient/terminal taxonomy + `Retry-After` — the fetcher already distinguishes 401/403 from
  other non-200s internally but discards the distinction into a flat 503 (§5)
- Separate failure cooldown + stale-serve; stop unconditionally overwriting last-good data with
  error entries; identity-scoped failures never cached shared (§4, §5)
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
- Document the unsigned-JWT trust boundary once in `docs/developer/CODA.md`, identically; name
  authlib/JWKS as the future-hardening item (§3)
- First-request credential diagnostics log (§9)
- Runtime smoke procedure in the PR body, gating dependent work and the final outbound header set
  (§3, §10)
