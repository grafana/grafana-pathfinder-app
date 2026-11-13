package plugin

import (
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Completion Records durable write proxy (docs/design/BACKEND_PROXY_PATTERN.md).
//
// POST /completion-records persists one terminal completion as a CompletionRecord
// in the stack's aggregated App Platform store. The outbound call carries a
// short-lived on-behalf-of access token minted from the caller's inbound ID token
// (pkg/plugin/auth), so authorization is still delegated to App Platform RBAC as
// the calling user — on the served group the basic viewer role grants write on
// CompletionRecord, so the proxy adds no privilege beyond what that user already
// gets upstream.
//
// These are lightweight self-reported records, not attested facts: because a
// Viewer can create the same CRD directly, the proxy's server-side stamping is a
// best-effort convenience, not an enforced identity boundary. That is a current,
// time-bounded limitation — a platform-side operator to close the forgery gap is
// under discussion with the App Platform team — not a permanent design property.
// What the proxy adds over a direct write is server-stamped identity/org/stack
// fields (the CRD validates field PRESENCE, not truth), per-user rate limiting
// (completion_records_write_ratelimit.go), read-cache invalidation on a
// successful create, and the transient/terminal retry taxonomy the front-end
// queue depends on.
//
// Response contract for the front-end retry queue (RFC §6.9). Owned by
// docs/design/BACKEND_PROXY_PATTERN.md §11; restated here because it is what this
// handler implements:
//   - 201  created (durable).
//   - 401  transient: an expired session or forwarded token recovers after
//          re-auth, so the client retries it with backoff.
//   - 404  structural "route not served on this stack" signal; the front end
//          disarms writes for the session (pending items persist for the next
//          load) rather than dropping. Four ways in: an upstream 404 (the create
//          POSTs to the completionrecords COLLECTION, so it means the whole
//          group/route is absent, never a per-record miss), a stack with no
//          provisioned on-behalf-of credential (reasonOBOUnavailable) — the
//          production case in ops/prod today (#1503) — an inbound identity this
//          stack can never verify (reasonIdentityUnverifiable: no app URL, so no
//          verifier can be built for this stack, or no server-derived namespace
//          to bind one to), and no reachable signing-keys endpoint at all
//          (reasonSigningKeysUnreachable).
//   - 403  the caller's identity holds no grant for this route. Echoed verbatim
//          from upstream. Like 404 it disarms writes for the session and KEEPS
//          the pending records for a later drain — a grant can be added without
//          the completion ever having happened again, so dropping would lose
//          data the user earned.
//   - 408 / 429 / 5xx / 3xx / network / token-exchange failure — transient; the client retries with
//          exponential backoff. Retry-After is set as a standard backpressure
//          hint, though Grafana's backendSrv does not expose response headers to
//          the front-end client.
//   - other 4xx  terminal — validation / schema; the write will never succeed
//          as posted, so the client drops it (no retry). 401/403/408/429 are
//          each carved out above and are NOT in this class.
//
// Idempotency: a non-blank idempotencyKey (#1434) is REQUIRED — a blank/missing
// key is a terminal 400. The record name is hash(userID || sep || key) over the
// trusted userID, so a retried POST targets the same object (409 → idempotent
// success) and two users' identical keys can never collide. See
// completionRecordName for the full invariant.

const (
	// completionWriteSchemaVersion is the CompletionRecord spec schemaVersion this
	// writer emits (the CRD requires >= 1).
	completionWriteSchemaVersion = 1

	// completionWriteRetryAfterSeconds is the default Retry-After hint on a
	// transient failure when the upstream provides none.
	completionWriteRetryAfterSeconds = 30

	// completionMaxClockSkew tolerates a client clock running slightly ahead of
	// the server when validating completedAt.

	// completionMaxBackdate is the oldest a client-supplied completedAt may be.
	// Deliberately generous: an offline/queued write may legitimately land days
	// after the user completed (RFC §6.9 durability boundary), but a value older
	// than this window is rejected as gross backdating or a bad client clock.
	completionMaxBackdate = 30 * 24 * time.Hour

	// completionWriteMaxBodyBytes bounds the decoded request body.
	completionWriteMaxBodyBytes = 64 * 1024

	// completionMaxDurationMs bounds a client-supplied guide duration (24h). A
	// single guide completion cannot realistically span longer; a larger value —
	// or any negative — is a producer bug or bad client clock, not durable data.
	// Out-of-range values are CLAMPED into range and logged, not rejected: the
	// duration is one denormalized convenience field on an otherwise valid
	// completion the user really earned, and failing the write would discard the
	// whole record over it. Clamping is lossy but visible; dropping is not.
	completionMaxDurationMs = 24 * 60 * 60 * 1000

	// Per-field byte caps on client-supplied free text. The CRD enforces field
	// presence, not content, so this writer is the only bound between a hostile
	// body and a durable record — and oversized stored strings can push read-path
	// LIST pages past their byte cap, wedging reads for the whole namespace.
	completionMaxIDLen    = 256
	completionMaxTitleLen = 1024

	// completionMaxDisplayLen bounds the server-derived login/display-name
	// snapshots before persistence. They are trusted for attribution, not
	// storage-bounded: an external identity-provider profile value can be
	// unusually large, and an oversized stored string pushes read-path LIST
	// pages past their byte cap (same hazard the client-fact caps guard).
	completionMaxDisplayLen = 256
)

// completionWriteRequest is the client-supplied fact for a durable write. It
// mirrors the front-end CompletionFact (src/completion-records/types.ts) plus
// `platform` — a required client-supplied CRD field the fact derives from the
// Grafana build info at send time.
//
// IDENTITY IS NEVER READ FROM THE BODY: this struct has no
// userId/userLogin/orgId/... fields, so any identity value a client smuggles in
// is dropped on decode and cannot influence the written record.
type completionWriteRequest = services.CompletionWriteRequest

// handleCreateCompletionRecord serves POST /completion-records.
func (a *App) handleCreateCompletionRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Identity is REQUIRED for a write and fails closed: unlike the soft-200 read
	// routes, a write with no verifiable caller serves no data. The failing
	// statuses are NOT interchangeable, because 401 is defined below as TRANSIENT —
	// the client retries it to the 30-day horizon — so only a time-recoverable
	// verdict may take it:
	//   - identityRejected: an expired/absent/foreign forwarded token recovers
	//     after re-auth, so it is the 401.
	//   - identityUnverifiable (no app URL, or no server-derived namespace) and
	//     identitySigningKeysDown (no signing-keys endpoint reachable at all) are
	//     both standing conditions no re-auth resolves, so both take the
	//     structural 404 carrying their own reason token. A 401 would make every
	//     queued write retry to the horizon and never disarm; the 404 disarms the
	//     session while RETAINING the records, matching how the read path serves
	//     the same two statuses.
	// //exhaustive:enforce makes a newly added status a lint failure here rather
	// than a silent 401. The default arm stays as the fail-closed catch-all.
	userID, userLogin, userDisplayName, status := a.completionWriterIdentity(r)
	//exhaustive:enforce
	switch status {
	case identityVerified:
	case identityUnverifiable, identitySigningKeysDown:
		reason := status.capabilityReason()
		a.ctxLogger(r.Context()).Info("completion write route unavailable (structural)", "reason", reason)
		a.writeProxyError(w, reason, http.StatusNotFound, proxyGateDiagnostic("identity-unavailable", "completionrecords", "create", "identity"))
		return
	case identityUnknown, identityRejected:
		a.writeProxyError(w, "unauthenticated", http.StatusUnauthorized, proxyGateDiagnostic("identity-unavailable", "completionrecords", "create", "identity"))
		return
	default:
		a.writeProxyError(w, "unauthenticated", http.StatusUnauthorized, proxyGateDiagnostic("identity-unavailable", "completionrecords", "create", "identity"))
		return
	}
	if userLogin == "" {
		// The record is still written — the login snapshot is display convenience,
		// not the identity of record. Logged so a token issuer that stops emitting
		// the claim is discoverable rather than silently degrading every record.
		a.ctxLogger(r.Context()).Info("completion write: ID token carried no username claim, omitting userLogin")
	}

	// Per-user flood guard (RFC §9) before any upstream work.
	if a.completionWriteRateLimiter != nil {
		if allow, retryAfter := a.completionWriteRateLimiter.allow(userID); !allow {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
			a.ctxLogger(r.Context()).Debug("completion write rate-limited (local)")
			a.writeError(w, "rate-limited", http.StatusTooManyRequests)
			return
		}
	}

	creator, namespace, available, reason := a.resolveCompletionWriteBackend(r)
	if !available {
		// Structurally can't write here ("never works here"). Disarms the client
		// for this session; the front end re-arms on a later app load and
		// re-attempts, so a stack that gains the backend later starts recording then.
		a.ctxLogger(r.Context()).Info("completion write route unavailable (structural)", "namespace", namespace, "reason", reason)
		a.writeProxyError(w, reason, http.StatusNotFound, proxyGateDiagnostic("proxy-unavailable", "completionrecords", "create", "configuration"))
		return
	}

	req, err := decodeCompletionWriteRequest(w, r)
	if err != nil {
		a.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	spec, err := a.buildCompletionSpec(r, req, userID, userLogin, userDisplayName, namespace)
	if err != nil {
		a.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.AttemptID != "" {
		spec.AttemptStartedAt = req.AttemptStartedAt
		if spec.AttemptStartedAt == "" {
			spec.AttemptStartedAt = req.CompletedAt
		}
		a.handleCompletionAttemptWrite(w, r, creator, namespace, userID, req.AttemptID, spec)
		return
	}

	// Identity-scoped deterministic name: userID is verified above, and the key is
	// validated non-blank in buildCompletionSpec. Every create carries this name,
	// which is the invariant that makes an upstream 409 provably our own record.
	name, err := services.CreateCompletion(r.Context(), creator, namespace, spec, req.IdempotencyKey, isAlreadyExistsUpstream)
	if err != nil {
		a.writeCompletionUpstreamError(w, r, err)
		return
	}

	// Surface the new record promptly on the next GET /completion-records/my.
	invalidateCompletionIndex(namespace)
	a.writeSatisfiedAssignments(r, userID, completionRecordSpec{
		UserID:            spec.UserID,
		GuideID:           spec.GuideID,
		GuideSource:       spec.GuideSource,
		GuideTitle:        spec.GuideTitle,
		GuideCategory:     spec.GuideCategory,
		PathID:            spec.PathID,
		Source:            spec.Source,
		CompletedAt:       spec.CompletedAt,
		CompletionPercent: spec.CompletionPercent,
	})
	a.ctxLogger(r.Context()).Debug("completion record created",
		"namespace", namespace, "guideSource", spec.GuideSource, "guideId", spec.GuideID, "name", name)
	a.writeJSON(w, map[string]string{"name": name}, http.StatusCreated)
}

// decodeCompletionWriteRequest reads the bounded JSON body into the client-fact
// struct. Unknown fields (including any smuggled identity) are ignored rather
// than rejected — the typed struct simply has nowhere to put them, which is how
// "never trust client identity" is enforced without brittle skew failures.
func decodeCompletionWriteRequest(w http.ResponseWriter, r *http.Request) (completionWriteRequest, error) {
	var req completionWriteRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, completionWriteMaxBodyBytes))
	if err := dec.Decode(&req); err != nil {
		return req, fmt.Errorf("invalid request body")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return req, fmt.Errorf("invalid request body")
	}
	return req, nil
}

// buildCompletionSpec validates the client fact against the CRD's value domains
// and assembles the FULL spec, stamping every writer-owned field from the
// verified request context. Returns a validation error (→ terminal 400) when any
// client field violates the schema.
func (a *App) buildCompletionSpec(r *http.Request, req completionWriteRequest, userID, userLogin, userDisplayName, namespace string) (completionRecordWriteSpec, error) {
	return services.BuildCompletionSpec(req, userID, userLogin, userDisplayName, namespace, backend.PluginConfigFromContext(r.Context()).OrgID, timeNow(), a.ctxLogger(r.Context())) //nolint:staticcheck // orgId is retained in the stored schema
}
func validateBoundedText(field, value string, maxBytes int) error {
	return services.ValidateBoundedText(field, value, maxBytes)
}

func (a *App) writeCompletionUpstreamError(w http.ResponseWriter, r *http.Request, err error) {
	logger := a.ctxLogger(r.Context())
	status, hasStatus := upstreamStatusOf(err)
	if !hasStatus {
		w.Header().Set("Retry-After", strconv.Itoa(completionWriteRetryAfterSeconds))
		if isTokenExchangeError(err) {
			logger.Warn("completion write token exchange failed (transient, retried)", "reason", classifyGuideProxyError(err).Reason)
		} else {
			logger.Debug("completion write transient (no upstream status)", "reason", classifyGuideProxyError(err).Reason)
		}
		a.writeProxyError(w, "completion-write-unavailable", http.StatusServiceUnavailable, appPlatformDiagnostic(err, "completionrecords", "create"))
		return
	}
	if isTransientUpstreamStatus(status) {
		retryAfter := upstreamRetryAfterOf(err)
		if retryAfter == "" {
			retryAfter = strconv.Itoa(completionWriteRetryAfterSeconds)
		}
		w.Header().Set("Retry-After", retryAfter)
		logger.Debug("completion write transient upstream failure", "status", status, "reason", classifyGuideProxyError(err).Reason)
		responseStatus := status
		if status >= 200 && status < 400 {
			responseStatus = http.StatusBadGateway
		}
		a.writeProxyError(w, "completion-write-unavailable", responseStatus, appPlatformDiagnostic(err, "completionrecords", "create"))
		return
	}
	switch status {
	case http.StatusUnauthorized:
		logger.Warn("completion write unauthorized upstream (minted credential rejected, retried)", "status", status, "reason", classifyGuideProxyError(err).Reason)
	case http.StatusForbidden:
		logger.Warn("completion write forbidden upstream (disarms client, records retained)", "status", status, "reason", classifyGuideProxyError(err).Reason)
	default:
		logger.Info("completion write terminal upstream failure", "status", status, "reason", classifyGuideProxyError(err).Reason)
	}
	a.writeProxyError(w, "completion-write-rejected", status, appPlatformDiagnostic(err, "completionrecords", "create"))
}

// completionRecordName mints the DNS-safe object name for a create. The name is
// DETERMINISTIC and IDENTITY-SCOPED: a SHA-256 over the trusted server-stamped
// userID and the exact (validated, non-blank) idempotencyKey, domain-separated
// so the two components cannot run together ambiguously. Scoping to userID means
// two users submitting the same key target DIFFERENT objects — one caller's key
// can never collide with another's in the shared namespace, so an upstream 409
// is provably the caller's own committed record and is treated as idempotent
// success. Hashing keeps the name DNS-safe for any key content, sidestepping CRD
// naming constraints. The caller guarantees a non-blank key (buildCompletionSpec
// rejects a blank one with a 400); client-supplied names are never accepted.
func completionRecordName(userID, idempotencyKey string) string {
	return services.CompletionRecordName(userID, idempotencyKey)
}

// isAlreadyExistsUpstream reports whether an upstream create failed only because
// the record already exists (409). Because every create supplies the identity-
// scoped deterministic completionRecordName, a 409 is unambiguously the caller's
// own prior committed record — an idempotent success, not a duplicate or error.
// Returns false for a nil error.
func isAlreadyExistsUpstream(err error) bool {
	status, ok := upstreamStatusOf(err)
	return ok && status == http.StatusConflict
}

// boundedIdentityField normalizes a server-derived login/display-name snapshot
// for durable storage: it strips control characters (which have no place in an
// identity value and could corrupt read-path rendering) and truncates to
// maxBytes on a rune boundary. Unlike client-fact fields these are trusted for
// attribution, so an unusual identity-provider value is sanitized rather than
// rejected — a write must never fail on an oversized or odd profile string.
func boundedIdentityField(value string, maxBytes int) string {
	return services.BoundedIdentityField(value, maxBytes)
}
