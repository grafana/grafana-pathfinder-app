package services

import (
	"context"
	"errors"
	"testing"
)

type conflictingCreateStore struct {
	CompletionRecordUpdater
	stored    *StoredCompletionRecord
	conflicts int
	calls     int
}

var errCreateConflict = errors.New("storage conflict")

func (s *conflictingCreateStore) Create(context.Context, string, CompletionRecordObject) error {
	s.calls++
	if s.calls <= s.conflicts {
		return errCreateConflict
	}
	return nil
}

func (s *conflictingCreateStore) Get(context.Context, string, string) (*StoredCompletionRecord, error) {
	return s.stored, nil
}

func TestCreateOrConfirmCompletion(t *testing.T) {
	spec := CompletionRecordWriteSpec{UserID: "user:1", GuideID: "first", GuideSource: "app-platform"}
	prior := spec
	prior.CompletedAt = "2026-11-19T10:00:00Z"
	other := spec
	other.GuideID = "other"
	for _, tt := range []struct {
		name      string
		store     conflictingCreateStore
		wantCalls int
		wantSpec  CompletionRecordWriteSpec
		wantErr   error
	}{
		{"retry missing record", conflictingCreateStore{conflicts: 1}, 2, spec, nil},
		{"persistent conflict without record", conflictingCreateStore{conflicts: 3}, 3, spec, ErrAttemptContended},
		{"use original completion on replay", conflictingCreateStore{conflicts: 1, stored: &StoredCompletionRecord{Spec: prior}}, 1, prior, nil},
		{"reject key reused for another guide", conflictingCreateStore{conflicts: 1, stored: &StoredCompletionRecord{Spec: other}}, 1, spec, ErrAttemptIdentityMismatch},
	} {
		t.Run(tt.name, func(t *testing.T) {
			name, got, err := CreateOrConfirmCompletion(context.Background(), &tt.store, "default", spec, "key", func(err error) bool { return errors.Is(err, errCreateConflict) })
			if tt.store.calls != tt.wantCalls || !errors.Is(err, tt.wantErr) || got != tt.wantSpec || (err == nil && name != CompletionRecordName(spec.UserID, "key")) {
				t.Fatalf("calls=%d, name=%q, spec=%+v, err=%v", tt.store.calls, name, got, err)
			}
		})
	}
}
