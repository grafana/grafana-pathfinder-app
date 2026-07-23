package plugin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
// in the stack's aggregated App Platform store. Identity/org/stack are stamped
// SERVER-SIDE from the verified request context and never trusted from the body
// (the CRD's manifest-only posture means it enforces field PRESENCE but not
// TRUTHFULNESS — that is this writer's job). Authorization is delegated to App
// Platform RBAC on the caller's own forwarded identity; the proxy adds no
// privilege beyond what that token gets upstream.
//
// INTERIM: a live RBAC probe (2026-07-23) showed Viewer tokens get 403 on
// creates against this API group while reads succeed. Because this proxy
// forwards the same Viewer identity, Viewer completions currently fail terminal
// upstream and are silently dropped by the client. Live Viewer attribution is a
// tracked merge gate for un-darking this feature.
//
// Response contract for the front-end retry queue (RFC §6.9):
//   - 201  created (durable).
//   - 404  reserved for the structural "route not deployed here" signal; the
//          front end disarms writes for the session (pending items persist for
//          the next load). Upstream per-record 404s are remapped to 422 so
//          they can never trigger that disarm.
//   - other 4xx  terminal — validation / schema / 403; the write will never
//          succeed as posted, so the client drops it (no retry). 401 is the
//          exception: an expired session or forwarded token recovers after
//          re-auth, so the client retries it as transient.
//   - 429 / 5xx / network — transient; the client retries with exponential
//          backoff. Retry-After is set as a standard backpressure hint, though
//          Grafana's backendSrv does not expose response headers to the
//          front-end client.

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

	name, err := generateCompletionRecordName()
	if err != nil {
		a.ctxLogger(r.Context()).Error("completion write: name generation failed", "error", err)
		a.writeError(w, "internal-error", http.StatusInternalServerError)
		return
	}

	obj := completionRecordObject{
		APIVersion: completionRecordsGroupVersion,
		Kind:       "CompletionRecord",
		Metadata:   completionRecordObjectMeta{Name: name, Namespace: namespace},
		Spec:       spec,
	}

	if err := creator.Create(r.Context(), namespace, obj); err != nil {
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
	for _, f := range []struct {
		name  string
		value string
		max   int
	}{
		{"guideId", req.GuideID, completionMaxIDLen},
		{"guideSource", req.GuideSource, completionMaxIDLen},
		{"pathId", req.PathID, completionMaxIDLen},
		{"guideTitle", req.GuideTitle, completionMaxTitleLen},
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
		UserLogin:       userLogin,
		UserDisplayName: userDisplayName,
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
	// 401/403. Echo the upstream status; the client drops these (except 401,
	// which it retries as transient — an expired token recovers). A 404 is the
	// other exception — the front end reserves 404 for the structural "route not
	// deployed" whole-feature disarm, so an upstream create 404 (this record only)
	// is remapped to 422 to avoid disarming the entire session.
	responseStatus := status
	if responseStatus == http.StatusNotFound {
		responseStatus = http.StatusUnprocessableEntity
	}
	logger.Info("completion write terminal upstream failure", "status", status, "error", err)
	a.writeError(w, "completion-write-rejected", responseStatus)
}

// generateCompletionRecordName mints a unique, DNS-safe object name for each
// create. Names are server-generated (client-supplied names are rejected) and
// carry no idempotency semantics by design — every accepted POST is a new record.
func generateCompletionRecordName() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "completion-" + hex.EncodeToString(buf), nil
}
