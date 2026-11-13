package plugin

import (
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"strconv"
)

// Attempt upsert for POST /completion-records (incremental progress).
//
// A body that carries `attemptId` is one guide attempt's progress. Each attempt
// has exactly one record, named from (userID, attemptId) alone, which the
// plugin creates at the attempt's first write and then updates in place until
// it reaches 100%:
//
//   - GET the record by name. A NotFound Status means "create it"; a 409 on
//     that create means another write won the race, so read again.
//   - A stored record that belongs to another user or another guide is a 409
//     `attempt-conflict` (terminal; the client drops it).
//   - A stored percent at or above the incoming one is a 200 no-op, so replays,
//     retries and out-of-order arrivals never lower progress.
//   - Otherwise PUT the full object with the resourceVersion it was read at. A
//     stale version is a 409, retried from the GET up to
//     completionAttemptMaxTries times, then a retryable 503.
//   - completedAt, the real source and the duration are written only when the
//     attempt reaches 100%. A partial carries none of them.
//   - An old CRD that still requires completedAt rejects a partial as Invalid
//     (422). That maps to a retryable 503 `schema-not-ready`, never a terminal
//     4xx, so the queued partial survives until the schema is deployed.
//
// Responses: 201 created, 200 updated or no-op, 409 attempt-conflict, 503
// (contended or schema-not-ready), plus every status the legacy create can
// return (writeCompletionUpstreamError). A body without attemptId never reaches
// this file.

const (
	// completionAttemptMaxTries bounds the GET→write loop on 409s.
	completionAttemptMaxTries = 3

	reasonAttemptConflict              = "attempt-conflict"
	reasonWriteContended               = "completion-write-contended"
	reasonSchemaNotReady               = "schema-not-ready"
	completionRecordKindStr            = "CompletionRecord"
	completionAttemptStartedAnnotation = "pathfinder.grafana.com/attempt-started-at"
)

var errAttemptContended = services.ErrAttemptContended

// completionAttemptRecordName is the record name for one attempt. Like
// completionRecordName it is scoped to the trusted userID; the "attempt" label
// after the separator keeps it disjoint from every legacy name, because a
// legacy idempotency key can never contain the separator byte.
func completionAttemptRecordName(userID, attemptID string) string {
	return services.CompletionAttemptRecordName(userID, attemptID)
}

// attemptWriteSpec turns a validated client spec into what an attempt record
// stores at this percent: completedAt, the source and the duration only at 100.
func attemptWriteSpec(spec completionRecordWriteSpec) completionRecordWriteSpec {
	return services.AttemptWriteSpec(spec)
}

type attemptOutcome = services.AttemptOutcome

const (
	attemptCreated   = services.AttemptCreated
	attemptUpdated   = services.AttemptUpdated
	attemptUnchanged = services.AttemptUnchanged
)

// upsertCompletionAttempt runs the GET → create/PUT loop for one attempt.
func upsertCompletionAttempt(r *http.Request, store completionRecordUpdater, namespace, name string, incoming completionRecordWriteSpec) (attemptOutcome, completionRecordWriteSpec, error) {
	return services.UpsertCompletionAttempt(r.Context(), store, namespace, name, incoming, func(err error) (int, string) {
		status, _ := upstreamStatusOf(err)
		return status, upstreamStatusReasonOf(err)
	})
}

var errAttemptIdentityMismatch = services.ErrAttemptIdentityMismatch

// handleCompletionAttemptWrite is the attemptId branch of
// handleCreateCompletionRecord, after identity, rate limit, backend and body
// validation have all passed.
func (a *App) handleCompletionAttemptWrite(w http.ResponseWriter, r *http.Request, creator completionRecordCreator, namespace string, userID string, attemptID string, spec completionRecordWriteSpec) {
	store, ok := creator.(completionRecordUpdater)
	if !ok {
		// Only a test double can lack the update surface; production always has it.
		a.writeProxyError(w, "completion-write-unavailable", http.StatusServiceUnavailable, proxyGateDiagnostic("proxy-unavailable", "completionrecords", "update", "configuration"))
		return
	}

	name := completionAttemptRecordName(userID, attemptID)
	incoming := attemptWriteSpec(spec)
	outcome, persisted, err := upsertCompletionAttempt(r, store, namespace, name, incoming)
	logger := a.ctxLogger(r.Context())
	switch {
	case err == nil:
	case errors.Is(err, errAttemptIdentityMismatch):
		logger.Warn("completion attempt write: stored record does not match the caller or guide (dropped)", "namespace", namespace, "name", name)
		a.writeError(w, reasonAttemptConflict, http.StatusConflict)
		return
	case errors.Is(err, errAttemptContended):
		logger.Info("completion attempt write: contended, asking the client to retry", "namespace", namespace, "name", name)
		w.Header().Set("Retry-After", strconv.Itoa(completionWriteRetryAfterSeconds))
		a.writeError(w, reasonWriteContended, http.StatusServiceUnavailable)
		return
	case incoming.CompletionPercent < 100 && isSchemaNotReady(err):
		logger.Info("completion attempt write: schema does not accept a partial yet (retried)", "namespace", namespace)
		w.Header().Set("Retry-After", strconv.Itoa(completionWriteRetryAfterSeconds))
		a.writeError(w, reasonSchemaNotReady, http.StatusServiceUnavailable)
		return
	default:
		a.writeCompletionUpstreamError(w, r, err)
		return
	}

	status := http.StatusOK
	if outcome == attemptCreated {
		status = http.StatusCreated
	}
	if outcome != attemptUnchanged || persisted.CompletedAt != "" {
		invalidateCompletionIndex(namespace)
	}
	if persisted.CompletedAt != "" {
		a.writeSatisfiedAssignments(r, userID, completionRecordSpec{
			UserID:            persisted.UserID,
			GuideID:           persisted.GuideID,
			GuideSource:       persisted.GuideSource,
			GuideTitle:        persisted.GuideTitle,
			GuideCategory:     persisted.GuideCategory,
			PathID:            persisted.PathID,
			Source:            persisted.Source,
			CompletedAt:       persisted.CompletedAt,
			CompletionPercent: persisted.CompletionPercent,
		})
	}
	logger.Debug("completion attempt written", "namespace", namespace, "name", name,
		"percent", incoming.CompletionPercent, "outcome", outcome)
	a.writeJSON(w, map[string]string{"name": name}, status)
}

func isSchemaNotReady(err error) bool {
	var upstream *appPlatformUpstreamError
	if !errors.As(err, &upstream) || upstream.status != http.StatusUnprocessableEntity {
		return false
	}
	var status struct {
		Kind    string `json:"kind"`
		Reason  string `json:"reason"`
		Details struct {
			Causes []struct {
				Field  string `json:"field"`
				Reason string `json:"reason"`
			} `json:"causes"`
		} `json:"details"`
	}
	if json.Unmarshal(upstream.body, &status) != nil || status.Kind != "Status" || status.Reason != "Invalid" || len(status.Details.Causes) == 0 {
		return false
	}
	for _, cause := range status.Details.Causes {
		if cause.Field != "spec.completedAt" || cause.Reason != "FieldValueRequired" {
			return false
		}
	}
	return true
}
