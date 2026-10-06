package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
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

	reasonAttemptConflict   = "attempt-conflict"
	reasonWriteContended    = "completion-write-contended"
	reasonSchemaNotReady    = "schema-not-ready"
	completionRecordKindStr = "CompletionRecord"
)

var errAttemptContended = errors.New("completion attempt: write contended")

// completionAttemptRecordName is the record name for one attempt. Like
// completionRecordName it is scoped to the trusted userID; the "attempt" label
// after the separator keeps it disjoint from every legacy name, because a
// legacy idempotency key can never contain the separator byte.
func completionAttemptRecordName(userID, attemptID string) string {
	h := sha256.New()
	h.Write([]byte(userID))
	h.Write([]byte{0})
	h.Write([]byte("attempt"))
	h.Write([]byte{0})
	h.Write([]byte(attemptID))
	sum := h.Sum(nil)
	return "completion-" + hex.EncodeToString(sum[:16])
}

// attemptWriteSpec turns a validated client spec into what an attempt record
// stores at this percent: completedAt, the source and the duration only at 100.
func attemptWriteSpec(spec completionRecordWriteSpec) completionRecordWriteSpec {
	if spec.CompletionPercent < 100 {
		spec.CompletedAt = ""
		spec.Source = "objectives"
		spec.DurationSeconds = 0
	}
	return spec
}

type attemptOutcome int

const (
	attemptCreated attemptOutcome = iota
	attemptUpdated
	attemptUnchanged
)

// upsertCompletionAttempt runs the GET → create/PUT loop for one attempt.
func upsertCompletionAttempt(r *http.Request, store completionRecordUpdater, namespace, name string, incoming completionRecordWriteSpec) (attemptOutcome, error) {
	ctx := r.Context()
	for try := 0; try < completionAttemptMaxTries; try++ {
		stored, err := store.Get(ctx, namespace, name)
		if err != nil {
			return 0, err
		}
		if stored == nil {
			obj := completionRecordObject{
				APIVersion: completionRecordsGroupVersion,
				Kind:       completionRecordKindStr,
				Metadata:   completionRecordObjectMeta{Name: name, Namespace: namespace},
				Spec:       incoming,
			}
			err := store.Create(ctx, namespace, obj)
			if err == nil {
				return attemptCreated, nil
			}
			if isAlreadyExistsUpstream(err) {
				continue // another write created it first; read it and update
			}
			return 0, err
		}

		if stored.Spec.UserID != incoming.UserID || stored.Spec.GuideSource != incoming.GuideSource || stored.Spec.GuideID != incoming.GuideID {
			return 0, errAttemptIdentityMismatch
		}
		if stored.Spec.CompletionPercent >= incoming.CompletionPercent {
			return attemptUnchanged, nil
		}

		if err := store.Replace(ctx, namespace, name, mergeAttemptUpdate(stored, incoming)); err != nil {
			if isAlreadyExistsUpstream(err) {
				continue // stale resourceVersion; read again
			}
			return 0, err
		}
		return attemptUpdated, nil
	}
	return 0, errAttemptContended
}

var errAttemptIdentityMismatch = errors.New("completion attempt: stored record belongs to another user or guide")

// mergeAttemptUpdate writes the incoming progress onto the stored object,
// keeping every server-held field (metadata, resourceVersion, unknown spec
// fields). Identity and guide fields were checked equal; display fields take
// the latest values; completedAt/source/duration are set on crossing to 100.
func mergeAttemptUpdate(stored *storedCompletionRecord, incoming completionRecordWriteSpec) map[string]any {
	spec, _ := stored.Raw["spec"].(map[string]any)
	if spec == nil {
		spec = map[string]any{}
		stored.Raw["spec"] = spec
	}
	spec["completionPercent"] = incoming.CompletionPercent
	spec["recordedAt"] = incoming.RecordedAt
	spec["guideTitle"] = incoming.GuideTitle
	spec["guideCategory"] = incoming.GuideCategory
	spec["pathId"] = incoming.PathID
	spec["userLogin"] = incoming.UserLogin
	spec["userDisplayName"] = incoming.UserDisplayName
	spec["platform"] = incoming.Platform
	if incoming.CompletionPercent >= 100 {
		spec["completedAt"] = incoming.CompletedAt
		spec["source"] = incoming.Source
		spec["durationSeconds"] = incoming.DurationSeconds
	}
	return stored.Raw
}

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
	outcome, err := upsertCompletionAttempt(r, store, namespace, name, incoming)
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
	if outcome != attemptUnchanged {
		invalidateCompletionIndex(namespace)
		if incoming.CompletionPercent >= 100 {
			a.writeSatisfiedAssignments(r, userID, completionRecordSpec{
				UserID:            incoming.UserID,
				GuideID:           incoming.GuideID,
				GuideSource:       incoming.GuideSource,
				GuideTitle:        incoming.GuideTitle,
				GuideCategory:     incoming.GuideCategory,
				PathID:            incoming.PathID,
				Source:            incoming.Source,
				CompletedAt:       incoming.CompletedAt,
				CompletionPercent: incoming.CompletionPercent,
			})
		}
	}
	logger.Debug("completion attempt written", "namespace", namespace, "name", name,
		"percent", incoming.CompletionPercent, "outcome", outcome)
	a.writeJSON(w, map[string]string{"name": name}, status)
}

// isSchemaNotReady reports an upstream 422 Invalid: the only way a valid
// partial is rejected is an old CRD that still requires completedAt.
func isSchemaNotReady(err error) bool {
	status, ok := upstreamStatusOf(err)
	return ok && status == http.StatusUnprocessableEntity
}
