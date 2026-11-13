package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"io"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func decodeSDKAttemptForTest(body []byte) (*services.StoredCompletionRecord, error) {
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	var obj services.CompletionRecordObject
	if err := json.Unmarshal(body, &obj); err != nil {
		return nil, err
	}
	return &services.StoredCompletionRecord{Raw: raw, Spec: obj.Spec}, nil
}
func sdkAttemptBody(percent int) map[string]any {
	return map[string]any{"guideSource": "bundled", "guideId": "first-dashboard", "guideTitle": "First dashboard", "guideCategory": "interactive", "completionPercent": percent, "source": "objectives", "completedAt": time.Now().UTC().Format(time.RFC3339), "platform": "oss", "idempotencyKey": "evt-default", "attemptId": "attempt-1"}
}
func sdkWrite(t *testing.T, h simple.AppCustomRouteHandler, subject, namespace string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if subject != "" {
		ctx = authlib.WithAuthInfo(ctx, writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: namespace}, subject: subject}})
	}
	w := httptest.NewRecorder()
	err = h(ctx, w, &app.CustomRouteRequest{Method: http.MethodPost, Body: io.NopCloser(bytes.NewReader(raw)), ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
	if err != nil {
		t.Fatal(err)
	}
	return w
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

func (f *fakeAttemptStore) Create(_ context.Context, _ string, obj services.CompletionRecordObject) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates++
	if f.createErr != nil {
		return f.createErr
	}
	if _, exists := f.objects[obj.Metadata.Name]; exists {
		return apierrors.NewConflict(schema.GroupResource{Resource: "completionrecords"}, obj.Metadata.Name, errors.New("exists"))
	}
	raw := toRawObject(obj)
	f.rv++
	raw["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(f.rv)
	f.objects[obj.Metadata.Name] = raw
	return nil
}

func (f *fakeAttemptStore) Get(_ context.Context, _ string, name string) (*services.StoredCompletionRecord, error) {
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
	return decodeSDKAttemptForTest(body)
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
		return apierrors.NewNotFound(schema.GroupResource{Resource: "completionrecords"}, name)
	}
	gotRV := obj["metadata"].(map[string]any)["resourceVersion"]
	if gotRV != cur["metadata"].(map[string]any)["resourceVersion"] {
		return apierrors.NewConflict(schema.GroupResource{Resource: "completionrecords"}, name, errors.New("stale"))
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

func toRawObject(obj services.CompletionRecordObject) map[string]any {
	body, _ := json.Marshal(obj)
	var raw map[string]any
	_ = json.Unmarshal(body, &raw)
	return raw
}

func TestSDKCompletionWritesPreserveIdentityProgressAndRepair(t *testing.T) {
	store := newFakeAttemptStore()
	repairs := 0
	handler := completionWriteHandler(store, func(_ context.Context, namespace string, record services.CompletionRecord) {
		repairs++
		if namespace != "default" || record.UserID != "user:1" || record.CompletionPercent != 100 {
			t.Fatalf("incorrect repair: %s %+v", namespace, record)
		}
	})
	for _, identity := range []struct{ subject, namespace string }{{"", "default"}, {"user:1", "other"}, {"user:1", "*"}} {
		w := sdkWrite(t, handler, identity.subject, identity.namespace, sdkAttemptBody(40))
		if w.Code != 401 {
			t.Fatalf("identity accepted: %d", w.Code)
		}
	}
	if store.gets != 0 || store.creates != 0 {
		t.Fatal("untrusted caller reached storage")
	}
	for i, percent := range []int{40, 70, 20, 100, 40, 100} {
		body := sdkAttemptBody(percent)
		body["userId"] = "user:forged"
		body["namespace"] = "other"
		body["orgId"] = 99
		w := sdkWrite(t, handler, "user:1", "default", body)
		want := 200
		if i == 0 {
			want = 201
		}
		if w.Code != want {
			t.Fatalf("percent=%d status=%d body=%s", percent, w.Code, w.Body.String())
		}
	}
	name := services.CompletionAttemptRecordName("user:1", "attempt-1")
	spec := store.spec(t, name)
	if spec["userId"] != "user:1" || spec["orgId"] != float64(1) || spec["stackNamespace"] != "default" || spec["completionPercent"] != float64(100) {
		t.Fatalf("stored identity/progress: %+v", spec)
	}
	if store.creates != 1 || store.replaces != 2 || repairs != 3 {
		t.Fatalf("creates=%d replaces=%d repairs=%d", store.creates, store.replaces, repairs)
	}
}
func TestSDKCompletionWriteErrorsAndSchemaReadiness(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"forbidden", apierrors.NewForbidden(schema.GroupResource{Resource: "completionrecords"}, "attempt", errors.New("denied")), 403, "completion-write-rejected"},
		{"missing resource", apierrors.NewNotFound(schema.GroupResource{Resource: "completionrecords"}, "attempt"), 404, "completion-write-rejected"},
		{"transport", errors.New("connection interrupted"), 503, "completion-write-unavailable"},
		{"old schema", &apierrors.StatusError{ErrStatus: metav1.Status{Code: 422, Reason: metav1.StatusReasonInvalid, Details: &metav1.StatusDetails{Causes: []metav1.StatusCause{{Type: metav1.CauseTypeFieldValueRequired, Field: "spec.completedAt"}}}}}, 503, "schema-not-ready"},
		{"other validation", &apierrors.StatusError{ErrStatus: metav1.Status{Code: 422, Reason: metav1.StatusReasonInvalid, Details: &metav1.StatusDetails{Causes: []metav1.StatusCause{{Type: metav1.CauseTypeFieldValueRequired, Field: "spec.guideId"}}}}}, 422, "completion-write-rejected"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeAttemptStore()
			store.createErr = tc.err
			handler := completionWriteHandler(store, func(context.Context, string, services.CompletionRecord) {
				t.Fatal("failed write synchronized assignments")
			})
			w := sdkWrite(t, handler, "user:1", "default", sdkAttemptBody(40))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.message) {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.status == 503 && w.Header().Get("Retry-After") == "" {
				t.Fatal("retry delay missing")
			}
		})
	}
}
func TestSDKCompletionRateLimitAndInputBounds(t *testing.T) {
	store := newFakeAttemptStore()
	handler := completionWriteHandler(store, func(context.Context, string, services.CompletionRecord) {})
	for i := 0; i < 20; i++ {
		w := sdkWrite(t, handler, "user:1", "default", sdkAttemptBody(40))
		if w.Code >= 400 {
			t.Fatalf("request %d: %d", i, w.Code)
		}
	}
	w := sdkWrite(t, handler, "user:1", "default", sdkAttemptBody(40))
	if w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatalf("rate limit=%d", w.Code)
	}
	w = sdkWrite(t, handler, "user:2", "default", sdkAttemptBody(40))
	if w.Code != 201 {
		t.Fatal("rate limit shared across users")
	}
	body := sdkAttemptBody(40)
	body["guideTitle"] = strings.Repeat("x", 70*1024)
	if w := sdkWrite(t, handler, "user:3", "default", body); w.Code != 400 {
		t.Fatalf("oversized body accepted: %d", w.Code)
	}
}

func sdkCompletionBody() map[string]any {
	body := sdkAttemptBody(100)
	delete(body, "attemptId")
	return body
}
func TestCompletionWrite_Validation(t *testing.T) {

	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing guideId", func(b map[string]any) { delete(b, "guideId") }},
		{"missing guideSource", func(b map[string]any) { delete(b, "guideSource") }},
		{"missing idempotencyKey", func(b map[string]any) { delete(b, "idempotencyKey") }},
		{"blank idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = "" }},
		{"whitespace idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = "   " }},
		{"oversized idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = strings.Repeat("a", 256+1) }},
		{"invalid source", func(b map[string]any) { b["source"] = "teleport" }},
		{"invalid guideCategory", func(b map[string]any) { b["guideCategory"] = "podcast" }},
		{"invalid platform", func(b map[string]any) { b["platform"] = "mainframe" }},
		{"percent over 100", func(b map[string]any) { b["completionPercent"] = 101 }},
		{"percent negative", func(b map[string]any) { b["completionPercent"] = -1 }},
		{"oversized guideId", func(b map[string]any) { b["guideId"] = strings.Repeat("a", 256+1) }},
		{"oversized guideSource", func(b map[string]any) { b["guideSource"] = strings.Repeat("a", 256+1) }},
		{"oversized pathId", func(b map[string]any) { b["pathId"] = strings.Repeat("a", 256+1) }},
		{"oversized guideTitle", func(b map[string]any) { b["guideTitle"] = strings.Repeat("a", 1024+1) }},
		{"control characters in guideTitle", func(b map[string]any) { b["guideTitle"] = "First\x00dashboard" }},
		{"newline in guideId", func(b map[string]any) { b["guideId"] = "first\ndashboard" }},
		{"malformed completedAt", func(b map[string]any) { b["completedAt"] = "last tuesday" }},
		{"future completedAt", func(b map[string]any) {
			b["completedAt"] = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
		}},
		{"grossly backdated completedAt", func(b map[string]any) {
			b["completedAt"] = time.Now().Add(-30*24*time.Hour - 24*time.Hour).UTC().Format(time.RFC3339)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			creator := newFakeAttemptStore()
			handler := completionWriteHandler(creator, func(context.Context, string, services.CompletionRecord) {})
			body := sdkCompletionBody()
			tc.mutate(body)
			rec := sdkWrite(t, handler, "user:abc", "default", body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body: %s)", rec.Code, rec.Body.String())
			}
			if creator.creates != 0 {
				t.Fatalf("must not reach upstream on validation failure")
			}
		})
	}
}
func TestCompletionWrite_AcceptsEveryFrontendValue(t *testing.T) {

	frontendSources := []string{"objectives", "manual", "skipped"}
	frontendCategories := []string{"interactive", "documentation", "learning-journey"}
	frontendPlatforms := []string{"oss", "cloud"}

	for _, source := range frontendSources {
		for _, category := range frontendCategories {
			for _, platform := range frontendPlatforms {
				t.Run(source+"/"+category+"/"+platform, func(t *testing.T) {
					creator := newFakeAttemptStore()
					handler := completionWriteHandler(creator, func(context.Context, string, services.CompletionRecord) {})
					body := sdkCompletionBody()
					body["source"] = source
					body["guideCategory"] = category
					body["platform"] = platform
					// The frontend sends new Date().toISOString() — millisecond precision.
					body["completedAt"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00")
					rec := sdkWrite(t, handler, "user:abc", "default", body)
					if rec.Code != http.StatusCreated {
						t.Fatalf("status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
					}
				})
			}
		}
	}
}
