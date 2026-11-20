package services

import (
	"context"
	"errors"
	"net/http"
)

type AttemptOutcome int

const (
	AttemptCreated AttemptOutcome = iota
	AttemptUpdated
	AttemptUnchanged
)

var ErrAttemptContended = errors.New("completion attempt: write contended")

func UpsertCompletionAttempt(ctx context.Context, store CompletionRecordUpdater, namespace, name string, incoming CompletionRecordWriteSpec, classify func(error) (int, string)) (AttemptOutcome, CompletionRecordWriteSpec, error) {
	isConflict := func(err error) bool { status, _ := classify(err); return status == http.StatusConflict }
	for try := 0; try < 3; try++ {
		stored, err := store.Get(ctx, namespace, name)
		if err != nil {
			return 0, incoming, err
		}
		if stored == nil {
			obj := CompletionRecordObject{
				APIVersion: "pathfinderbackend.ext.grafana.app/v1alpha1",
				Kind:       "CompletionRecord",
				Metadata:   CompletionRecordObjectMeta{Name: name, Namespace: namespace, Annotations: map[string]string{"pathfinder.grafana.com/attempt-started-at": incoming.AttemptStartedAt}},
				Spec:       incoming,
			}
			err := store.Create(ctx, namespace, obj)
			if err == nil {
				return AttemptCreated, incoming, nil
			}
			if isConflict(err) {
				continue
			}
			return 0, incoming, err
		}

		if stored.Spec.UserID != incoming.UserID || stored.Spec.GuideSource != incoming.GuideSource || stored.Spec.GuideID != incoming.GuideID {
			return 0, incoming, ErrAttemptIdentityMismatch
		}
		if stored.Spec.CompletionPercent >= incoming.CompletionPercent {
			return AttemptUnchanged, stored.Spec, nil
		}

		if err := store.Replace(ctx, namespace, name, MergeAttemptUpdate(stored, incoming)); err != nil {
			status, reason := classify(err)
			if isConflict(err) || (status == http.StatusNotFound && reason == "NotFound") {
				continue // Re-read after a concurrent update or deletion, not a structural 404.
			}
			return 0, incoming, err
		}
		return AttemptUpdated, incoming, nil
	}
	return 0, incoming, ErrAttemptContended
}

var ErrAttemptIdentityMismatch = errors.New("completion attempt: stored record belongs to another user or guide")

// MergeAttemptUpdate writes the incoming progress onto the stored object,
// keeping every server-held field (metadata, resourceVersion, unknown spec
// fields). Identity and guide fields were checked equal; display fields take
// the latest values; completedAt/source/duration are set on crossing to 100.
func MergeAttemptUpdate(stored *StoredCompletionRecord, incoming CompletionRecordWriteSpec) map[string]any {
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
