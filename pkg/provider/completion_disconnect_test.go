package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestCompletionRetryAfterConnectionLossRepairsAssignmentAndCache(t *testing.T) {
	services.ResetCompletionCache()
	t.Cleanup(services.ResetCompletionCache)
	store := newFakeAttemptStore()
	var repairAttempts atomic.Int32
	var satisfied atomic.Bool
	assignment := services.Assignment{Name: "assigned", UserID: "user:1", TargetType: "guide", TargetID: "first-dashboard", TargetSource: "bundled", Lifecycle: "active"}
	handler := completionWriteHandler(store, func(ctx context.Context, namespace string, record services.CompletionRecord) {
		if namespace != "default" || record.UserID != "user:1" || ctx.Err() != nil {
			t.Error("repair lost the authenticated caller or usable context")
		}
		services.SyncSatisfiedAssignments([]services.Assignment{assignment}, record,
			&services.ObligationEvaluator{Context: ctx, Logger: log.DefaultLogger},
			func() ([]services.CompletionRecord, error) { return nil, nil },
			func(services.Assignment) {
				if repairAttempts.Add(1) > 1 {
					satisfied.Store(true)
				}
			}, log.DefaultLogger)
	})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		ctx := authlib.WithAuthInfo(request.Context(), writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}})
		buffer := httptest.NewRecorder()
		if err := handler(ctx, buffer, &app.CustomRouteRequest{Method: request.Method, Body: request.Body, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
			t.Error(err)
		}
		if requests.Add(1) == 1 {
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = connection.Close()
			return
		}
		for name, values := range buffer.Header() {
			w.Header()[name] = values
		}
		w.WriteHeader(buffer.Code)
		_, _ = w.Write(buffer.Body.Bytes())
	}))
	defer server.Close()
	cacheLoads := 0
	readCache := func() {
		_, err := services.LoadCompletionIndex(context.Background(), services.CallerCompletionCacheKey("default", "user:1"), false, log.DefaultLogger,
			func(context.Context) (*services.CompletionIndex, int, error) {
				cacheLoads++
				return &services.CompletionIndex{AsOf: time.Now()}, 1, nil
			}, time.Now, func(error) bool { return false }, func(error) string { return "" })
		if err != nil {
			t.Fatal(err)
		}
	}
	readCache()
	body, err := json.Marshal(sdkAttemptBody(100))
	if err != nil {
		t.Fatal(err)
	}
	client := server.Client()
	client.Timeout = 5 * time.Second
	response, err := client.Post(server.URL, "application/json", bytes.NewReader(body))
	if response != nil {
		_ = response.Body.Close()
	}
	if err == nil {
		t.Fatal("first completion response was not lost")
	}
	name := services.CompletionAttemptRecordName("user:1", "attempt-1")
	before := store.spec(t, name)
	if before["completionPercent"] != float64(100) || repairAttempts.Load() != 1 || satisfied.Load() {
		t.Fatal("lost response did not retain the committed completion and failed repair")
	}
	readCache()
	response, err = client.Post(server.URL, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("retry: %d %s", response.StatusCode, data)
	}
	var result map[string]string
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result["name"] != name {
		t.Fatalf("retry changed record identity: %+v, %v", result, err)
	}
	readCache()
	after := store.spec(t, name)
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.objects) != 1 || store.creates != 1 || store.replaces != 0 || before["completedAt"] != after["completedAt"] {
		t.Fatal("retry duplicated or replaced the committed completion")
	}
	if repairAttempts.Load() != 2 || !satisfied.Load() || cacheLoads != 3 || requests.Load() != 2 {
		t.Fatalf("retry did not repair side effects: attempts=%d satisfied=%t cacheLoads=%d requests=%d", repairAttempts.Load(), satisfied.Load(), cacheLoads, requests.Load())
	}
}
