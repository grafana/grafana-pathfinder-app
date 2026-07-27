package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Completion Records durable write proxy (docs/design/BACKEND_PROXY_PATTERN.md).
//
// POST /completion-records persists one terminal completion as a CompletionRecord
// in the stack's aggregated App Platform store. Authorization is delegated to
// App Platform RBAC on the caller's own forwarded identity — on the served
// group the basic viewer role grants write on CompletionRecord, so the proxy
// adds no privilege beyond what that token already gets upstream.
//
// The proxy is retained for reasons a direct client write cannot satisfy:
//   - Identity TRUTHFULNESS: the CRD validates field PRESENCE, not truth. Only a
//     server can stamp userId/userLogin/userDisplayName/orgId/stackNamespace/
//     recordedAt trustworthily from the verified request context, never the body.
//   - Per-user rate limiting (completion_records_write_ratelimit.go).
//   - Read-cache invalidation on a successful create.
//   - The transient/terminal retry taxonomy the front-end queue depends on.
//
// Response contract for the front-end retry queue (RFC §6.9). The taxonomy is
// stated identically here, in the PR body, and in .cursor/rules/{systemPatterns,
// coda}.mdc — divergence re-creates the split-review bug:
//   - 201  created (durable).
//   - 401  transient: an expired session or forwarded token recovers after
//          re-auth, so the client retries it with backoff.
//   - 404  structural "route not served on this stack" signal; the front end
//          disarms writes for the session (pending items persist for the next
//          load) rather than dropping. The create POSTs to the completionrecords
//          COLLECTION, so an upstream 404 means the whole group/route is absent
//          — it is never a per-record miss and is never remapped away.
//   - 429 / 5xx / network — transient; the client retries with exponential
//          backoff. Retry-After is set as a standard backpressure hint, though
//          Grafana's backendSrv does not expose response headers to the
//          front-end client.
//   - other 4xx  terminal — validation / schema / 403; the write will never
//          succeed as posted, so the client drops it (no retry).
//
// Idempotency: a non-blank idempotencyKey (the completion event's stable client
// id, see #1434) is REQUIRED — a blank/missing key is a terminal 400, never a
// random-name fallback. The record name is derived DETERMINISTICALLY from the
// trusted server-stamped userID AND the exact key — hash(userID || sep || key) —
// so a retried POST targets the same object and an upstream "already exists"
// (409) is treated as idempotent success: a committed-but-unacknowledged write
// cannot duplicate. The name is scoped to the trusted userID, so two users
// submitting the same key target DIFFERENT objects — one caller's key can never
// collide with, or be acknowledged against, another caller's record in the
// shared namespace. The contract is first-write-wins per (userID, key): the key
// must be stable per completion event (which is exactly what #1434 sends), so a
// reused key with different content resolves to the first record for that key.

const (
	// completionWriteSchemaVersion is the CompletionRecord spec schemaVersion this
	// writer emits (the CRD requires >= 1).
	completionWriteSchemaVersion = 1

	// completionWriteRetryAfterSeconds is the default Retry-After hint on a
	// transient failure when the upstream provides none.
	completionWriteRetryAfterSeconds = 30

	// completionMaxClockSkew tolerates a client clock running slightly ahead of
	// the server when validating completedAt.
	completionMaxClockSkew = 5 * time.Minute

	// completionMaxBackdate is the oldest a client-supplied completedAt may be.
	// Deliberately generous: an offline/queued write may legitimately land days
	// after the user completed (RFC §6.9 durability boundary), but a value older
	// than this window is rejected as gross backdating or a bad client clock.
	completionMaxBackdate = 30 * 24 * time.Hour

	// completionWriteMaxBodyBytes bounds the decoded request body.
	completionWriteMaxBodyBytes = 64 * 1024

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

var (
	completionValidSources    = map[string]bool{"objectives": true, "manual": true, "skipped": true}
	completionValidCategories = map[string]bool{"interactive": true, "documentation": true, "learning-journey": true}
	completionValidPlatforms  = map[string]bool{"oss": true, "cloud": true}
)

// completionWriteRequest is the client-supplied fact for a durable write. It
// mirrors the front-end CompletionFact (src/completion-records/types.ts) plus
// `platform` — a required client-supplied CRD field the fact derives from the
// Grafana build info at send time.
//
// IDENTITY IS NEVER READ FROM THE BODY: this struct has no
// userId/userLogin/orgId/... fields, so any identity value a client smuggles in
// is dropped on decode and cannot influence the written record.
type completionWriteRequest struct {
	GuideSource       string `json:"guideSource"`
	GuideID           string `json:"guideId"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	CompletionPercent int64  `json:"completionPercent"`
	Source            string `json:"source"`
	CompletedAt       string `json:"completedAt"`
	DurationMs        *int64 `json:"durationMs"`
	Platform          string `json:"platform"`

	// IdempotencyKey is the completion event's stable client id (#1434). REQUIRED
	// and non-blank: it makes the write idempotent by deriving the record name
	// deterministically from the trusted userID and this key. It is never
	// persisted. A blank/missing key is a terminal 400 (no random-name fallback).
	IdempotencyKey string `json:"idempotencyKey"`
}

// handleCreateCompletionRecord serves POST /completion-records.
func (a *App) handleCreateCompletionRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Identity is REQUIRED for a write and fails closed: unlike the soft-200 read
	// routes, a write with no verifiable caller is a 401. The client retries it
	// with backoff — an expired forwarded token is time-recoverable after re-auth.
	userID, userLogin, userDisplayName, ok := completionWriterIdentity(r)
	if !ok {
		a.writeError(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	// Per-user flood guard (RFC §9) before any upstream work.
	if a.completionWriteRateLimiter != nil {
		if allow, retryAfter := a.completionWriteRateLimiter.allow(userID); !allow {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
			a.writeError(w, "rate-limited", http.StatusTooManyRequests)
			return
		}
	}

	creator, namespace, available, reason := a.resolveCompletionWriteBackend(r)
	if !available {
		// Structurally can't write here ("never works here"). Disarms the client
		// for this session; the front end re-arms on a later app load and
		// re-attempts, so a stack that gains the backend later starts recording then.
		a.writeError(w, reason, http.StatusNotFound)
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

	// Identity-scoped deterministic name (userID guaranteed present at :140, key
	// validated non-blank in buildCompletionSpec). Every create carries this name,
	// which is the invariant that makes an upstream 409 provably our own record.
	name := completionRecordName(userID, req.IdempotencyKey)

	obj := completionRecordObject{
		APIVersion: completionRecordsGroupVersion,
		Kind:       "CompletionRecord",
		Metadata:   completionRecordObjectMeta{Name: name, Namespace: namespace},
		Spec:       spec,
	}

	// An "already exists" (409) on the identity-scoped deterministic name means
	// this caller's own write already committed — treat it as idempotent success,
	// never a duplicate or a failure.
	if err := creator.Create(r.Context(), namespace, obj); err != nil && !isAlreadyExistsUpstream(err) {
		a.writeCompletionUpstreamError(w, r, err)
		return
	}

	// Surface the new record promptly on the next GET /completion-records/my.
	invalidateCompletionIndex(namespace)
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
	if req.GuideID == "" || req.GuideSource == "" {
		return completionRecordWriteSpec{}, fmt.Errorf("guideId and guideSource are required")
	}
	// A non-blank idempotency key is REQUIRED: the record name is derived from it
	// (with the trusted userID), so a blank key has no safe deterministic identity
	// and must not fall back to a random name. Reject before any upstream work.
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return completionRecordWriteSpec{}, fmt.Errorf("idempotencyKey is required")
	}
	for _, f := range []struct {
		name  string
		value string
		max   int
	}{
		{"guideId", req.GuideID, completionMaxIDLen},
		{"guideSource", req.GuideSource, completionMaxIDLen},
		{"pathId", req.PathID, completionMaxIDLen},
		{"guideTitle", req.GuideTitle, completionMaxTitleLen},
		{"idempotencyKey", req.IdempotencyKey, completionMaxIDLen},
	} {
		if err := validateBoundedText(f.name, f.value, f.max); err != nil {
			return completionRecordWriteSpec{}, err
		}
	}
	if !completionValidSources[req.Source] {
		return completionRecordWriteSpec{}, fmt.Errorf("invalid source")
	}
	if !completionValidCategories[req.GuideCategory] {
		return completionRecordWriteSpec{}, fmt.Errorf("invalid guideCategory")
	}
	if !completionValidPlatforms[req.Platform] {
		return completionRecordWriteSpec{}, fmt.Errorf("invalid platform")
	}
	if req.CompletionPercent < 0 || req.CompletionPercent > 100 {
		return completionRecordWriteSpec{}, fmt.Errorf("completionPercent out of range")
	}
	if err := validateCompletedAt(req.CompletedAt); err != nil {
		return completionRecordWriteSpec{}, err
	}

	durationSeconds := int64(0)
	if req.DurationMs != nil && *req.DurationMs > 0 {
		durationSeconds = *req.DurationMs / 1000
	}

	return completionRecordWriteSpec{
		GuideID:           req.GuideID,
		GuideSource:       req.GuideSource,
		GuideTitle:        req.GuideTitle,
		PathID:            req.PathID,
		Source:            req.Source,
		CompletedAt:       req.CompletedAt,
		DurationSeconds:   durationSeconds,
		CompletionPercent: req.CompletionPercent,
		GuideCategory:     req.GuideCategory,
		Platform:          req.Platform,

		UserID:          userID,
		UserLogin:       boundedIdentityField(userLogin, completionMaxDisplayLen),
		UserDisplayName: boundedIdentityField(userDisplayName, completionMaxDisplayLen),
		RecordedAt:      timeNow().UTC().Format(time.RFC3339),
		// The CRD requires a numeric orgId (RFC §7.1); PluginContext.OrgID is the
		// only source of it. The SDK deprecates OrgID for request *scoping* (use
		// Namespace, which we also record as stackNamespace), not for reading the
		// numeric org — so this remains the correct field for the value itself.
		OrgID:          backend.PluginConfigFromContext(r.Context()).OrgID, //nolint:staticcheck // numeric orgId required by CRD; Namespace is the string scope, not a number
		StackNamespace: namespace,
		SchemaVersion:  completionWriteSchemaVersion,
	}, nil
}

// validateBoundedText rejects oversized or control-character content in a
// client-supplied free-text field (→ terminal 400).
func validateBoundedText(field, value string, maxBytes int) error {
	if len(value) > maxBytes {
		return fmt.Errorf("%s exceeds %d bytes", field, maxBytes)
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%s contains control characters", field)
		}
	}
	return nil
}

// validateCompletedAt enforces the client-observed completion time is a valid
// RFC 3339 timestamp within [now-completionMaxBackdate, now+completionMaxClockSkew].
func validateCompletedAt(s string) error {
	t, ok := parseCompletionTime(s)
	if !ok {
		return fmt.Errorf("completedAt is not a valid RFC 3339 timestamp")
	}
	now := timeNow()
	if t.After(now.Add(completionMaxClockSkew)) {
		return fmt.Errorf("completedAt is in the future")
	}
	if t.Before(now.Add(-completionMaxBackdate)) {
		return fmt.Errorf("completedAt is too far in the past")
	}
	return nil
}

// writeCompletionUpstreamError maps an upstream create failure onto the front-end
// contract: transient (429/5xx/network → retryable, echoing Retry-After) vs
// terminal (other 4xx → drop; an echoed 401 is retried client-side as transient).
func (a *App) writeCompletionUpstreamError(w http.ResponseWriter, r *http.Request, err error) {
	logger := a.ctxLogger(r.Context())
	status, hasStatus := upstreamStatusOf(err)
	if !hasStatus {
		// Network / timeout / decode — no HTTP status, treat as transient.
		w.Header().Set("Retry-After", strconv.Itoa(completionWriteRetryAfterSeconds))
		logger.Debug("completion write transient (no upstream status)", "error", err)
		a.writeError(w, "completion-write-unavailable", http.StatusServiceUnavailable)
		return
	}
	if isTransientUpstreamStatus(status) {
		retryAfter := upstreamRetryAfterOf(err)
		if retryAfter == "" {
			retryAfter = strconv.Itoa(completionWriteRetryAfterSeconds)
		}
		w.Header().Set("Retry-After", retryAfter)
		logger.Debug("completion write transient upstream failure", "status", status, "error", err)
		responseStatus := status
		if status >= 200 && status < 300 {
			responseStatus = http.StatusBadGateway
		}
		a.writeError(w, "completion-write-unavailable", responseStatus)
		return
	}
	// Terminal 4xx: schema/validation rejected upstream, or identity-scoped
	// 401/403. Echo the upstream status VERBATIM; the client drops these (except
	// 401, which it retries as transient — an expired token recovers). A 404 is
	// preserved, not remapped: the create POSTs to the completionrecords
	// COLLECTION, so an upstream 404 means the group/route is not served on this
	// stack. That is the structural "route not deployed here" signal — the front
	// end disarms writes for the session and keeps the queued item — never a
	// per-record drop.
	logger.Info("completion write terminal upstream failure", "status", status, "error", err)
	a.writeError(w, "completion-write-rejected", status)
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
	h := sha256.New()
	// CORRECTNESS: userID MUST remain in this derivation. Dropping it collapses
	// the name back to the client key alone in a namespace shared across users,
	// re-opening the cross-user collision where one caller's 409 falsely
	// acknowledges another's write (pinned by TestCompletionWrite_CrossUserSameKeyDistinctRecords).
	h.Write([]byte(userID))
	// A zero byte separates the trusted identity from the client key. The key is
	// validated to contain no control characters (validateBoundedText), so it can
	// never contain this separator — the boundary is unambiguous regardless of
	// key content, defeating a (userID, key) ambiguity across callers.
	h.Write([]byte{0})
	h.Write([]byte(idempotencyKey))
	sum := h.Sum(nil)
	return "completion-" + hex.EncodeToString(sum[:16])
}

// isAlreadyExistsUpstream reports whether an upstream create failed only because
// the record already exists (409). Every create supplies an identity-scoped
// deterministic name (completionRecordName), so a 409 is unambiguously the
// caller's OWN prior committed record for this key — never another caller's or
// an unrelated object — and is an idempotent retry to treat as success, not a
// duplicate or an error. Returns false for a nil error.
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
func boundedIdentityField(s string, maxBytes int) string {
	var b strings.Builder
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			continue
		}
		if b.Len()+utf8.RuneLen(r) > maxBytes {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}
