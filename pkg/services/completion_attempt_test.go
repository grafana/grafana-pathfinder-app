package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"testing"
)

type attemptStoreError struct {
	status int
	msg    string
}

func (e *attemptStoreError) Error() string { return e.msg }
func classifyAttemptForTest(err error) (int, string) {
	var e *attemptStoreError
	if errors.As(err, &e) {
		return e.status, e.msg
	}
	return 0, ""
}
func decodeAttemptForTest(body []byte) (*StoredCompletionRecord, error) {
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var obj CompletionRecordObject
	if err := json.Unmarshal(body, &obj); err != nil {
		return nil, err
	}
	return &StoredCompletionRecord{Raw: raw, Spec: obj.Spec}, nil
}

type fakeAttemptStore struct {
	mu      sync.Mutex
	objects map[string]map[string]any
	rv      int

	createErr   error
	replaceErrs []error // consumed one per Replace call, before the write
	getErr      error

	creates, replaces, gets int
	lastReplace             map[string]any
}

func newFakeAttemptStore() *fakeAttemptStore {
	return &fakeAttemptStore{objects: map[string]map[string]any{}}
}

func (f *fakeAttemptStore) Create(_ context.Context, _ string, obj CompletionRecordObject) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates++
	if f.createErr != nil {
		return f.createErr
	}
	if _, exists := f.objects[obj.Metadata.Name]; exists {
		return &attemptStoreError{status: http.StatusConflict, msg: "exists"}
	}
	raw := toRawObject(obj)
	f.rv++
	raw["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(f.rv)
	f.objects[obj.Metadata.Name] = raw
	return nil
}

func (f *fakeAttemptStore) Get(_ context.Context, _ string, name string) (*StoredCompletionRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gets++
	if f.getErr != nil {
		return nil, f.getErr
	}
	raw, ok := f.objects[name]
	if !ok {
		return nil, nil
	}
	body, _ := json.Marshal(raw)
	return decodeAttemptForTest(body)
}

func (f *fakeAttemptStore) Replace(_ context.Context, _ string, name string, obj map[string]any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replaces++
	f.lastReplace = obj
	if len(f.replaceErrs) > 0 {
		err := f.replaceErrs[0]
		f.replaceErrs = f.replaceErrs[1:]
		if err != nil {
			return err
		}
	}
	cur := f.objects[name]
	if cur == nil {
		return &attemptStoreError{status: http.StatusNotFound, msg: "gone"}
	}
	gotRV := obj["metadata"].(map[string]any)["resourceVersion"]
	if gotRV != cur["metadata"].(map[string]any)["resourceVersion"] {
		return &attemptStoreError{status: http.StatusConflict, msg: "stale"}
	}
	body, _ := json.Marshal(obj)
	var stored map[string]any
	_ = json.Unmarshal(body, &stored)
	f.rv++
	stored["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(f.rv)
	f.objects[name] = stored
	return nil
}

func (f *fakeAttemptStore) spec(t *testing.T, name string) map[string]any {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, ok := f.objects[name]
	if !ok {
		t.Fatalf("no stored record %q", name)
	}
	return raw["spec"].(map[string]any)
}

func toRawObject(obj CompletionRecordObject) map[string]any {
	body, _ := json.Marshal(obj)
	var raw map[string]any
	_ = json.Unmarshal(body, &raw)
	return raw
}

func TestCompletionAttemptMonotonicRetries(t *testing.T) {
	store := newFakeAttemptStore()
	incoming := CompletionRecordWriteSpec{UserID: "user:1", GuideID: "guide", GuideSource: "app-platform", CompletionPercent: 20, AttemptStartedAt: "2026-11-01T00:00:00Z"}
	write := func(spec CompletionRecordWriteSpec, want AttemptOutcome) CompletionRecordWriteSpec {
		t.Helper()
		outcome, stored, err := UpsertCompletionAttempt(context.Background(), store, "default", "attempt", spec, classifyAttemptForTest)
		if err != nil || outcome != want {
			t.Fatalf("outcome=%v err=%v", outcome, err)
		}
		return stored
	}
	write(incoming, AttemptCreated)
	if _, exists := store.spec(t, "attempt")["completedAt"]; exists {
		t.Fatal("partial has completion timestamp")
	}
	store.objects["attempt"]["spec"].(map[string]any)["futureField"] = "preserved"
	incoming.CompletionPercent = 60
	write(incoming, AttemptUpdated)
	incoming.CompletionPercent = 20
	if got := write(incoming, AttemptUnchanged); got.CompletionPercent != 60 {
		t.Fatalf("progress regressed: %+v", got)
	}
	incoming.CompletionPercent = 100
	incoming.CompletedAt = "2026-11-01T00:10:00Z"
	incoming.Source = "manual"
	write(incoming, AttemptUpdated)
	incoming.CompletedAt = "2026-11-02T00:00:00Z"
	if got := write(incoming, AttemptUnchanged); got.CompletedAt != "2026-11-01T00:10:00Z" {
		t.Fatalf("retry changed completion: %+v", got)
	}
	if store.spec(t, "attempt")["futureField"] != "preserved" {
		t.Fatal("unknown field lost")
	}
	if store.creates != 1 || store.replaces != 2 {
		t.Fatalf("creates=%d replaces=%d", store.creates, store.replaces)
	}
	incoming.UserID = "user:2"
	if _, _, err := UpsertCompletionAttempt(context.Background(), store, "default", "attempt", incoming, classifyAttemptForTest); !errors.Is(err, ErrAttemptIdentityMismatch) {
		t.Fatalf("identity mismatch: %v", err)
	}
}
func TestCompletionAttemptConflictBudget(t *testing.T) {
	for _, tc := range []struct {
		name      string
		conflicts int
		contended bool
	}{{"one conflict", 1, false}, {"persistent conflict", 3, true}} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeAttemptStore()
			incoming := CompletionRecordWriteSpec{UserID: "user:1", GuideID: "guide", GuideSource: "bundled", CompletionPercent: 20}
			if _, _, err := UpsertCompletionAttempt(context.Background(), store, "default", "attempt", incoming, classifyAttemptForTest); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < tc.conflicts; i++ {
				store.replaceErrs = append(store.replaceErrs, &attemptStoreError{status: 409, msg: "Conflict"})
			}
			incoming.CompletionPercent = 80
			_, _, err := UpsertCompletionAttempt(context.Background(), store, "default", "attempt", incoming, classifyAttemptForTest)
			if errors.Is(err, ErrAttemptContended) != tc.contended || (err != nil && !tc.contended) {
				t.Fatalf("error=%v", err)
			}
			if store.replaces > 3 {
				t.Fatalf("unbounded retries: %d", store.replaces)
			}
		})
	}
}

func TestCompletionAttemptConcurrentUpdatesNeverRegress(t *testing.T) {
	store := newFakeAttemptStore()
	var workers sync.WaitGroup
	for _, percent := range []int64{10, 80, 20, 100, 40, 100, 60, 30} {
		workers.Add(1)
		go func(percent int64) {
			defer workers.Done()
			incoming := CompletionRecordWriteSpec{UserID: "user:1", GuideID: "guide", GuideSource: "bundled", CompletionPercent: percent}
			if percent == 100 {
				incoming.CompletedAt = "2026-11-01T00:10:00Z"
				incoming.Source = "manual"
			}
			for retry := 0; retry < 10; retry++ {
				_, _, err := UpsertCompletionAttempt(context.Background(), store, "default", "attempt", incoming, classifyAttemptForTest)
				if err == nil {
					return
				}
				if !errors.Is(err, ErrAttemptContended) {
					t.Errorf("write failed: %v", err)
					return
				}
			}
			t.Error("client retry budget exhausted")
		}(percent)
	}
	workers.Wait()
	spec := store.spec(t, "attempt")
	if spec["completionPercent"] != float64(100) || spec["completedAt"] != "2026-11-01T00:10:00Z" {
		t.Fatalf("lost concurrent completion: %+v", spec)
	}
	if len(store.objects) != 1 {
		t.Fatalf("duplicate attempts: %d", len(store.objects))
	}
}
