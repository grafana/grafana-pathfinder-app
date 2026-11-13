package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

type completionIdentity struct {
	testIdentity
	subject string
}

func (i completionIdentity) GetSubject() string { return i.subject }

func TestCompletionSDKCacheFiltersUsersAndInvalidates(t *testing.T) {
	services.ResetCompletionCache()
	t.Cleanup(services.ResetCompletionCache)
	calls := 0
	deny := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if deny {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"kind":"Status","status":"Failure","reason":"Forbidden","code":403}`))
			return
		}
		if r.URL.Query().Get("limit") != "500" {
			t.Error("incorrect page size")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"metadata":{},"items":[{"metadata":{"name":"a"},"spec":{"userId":"user:a","guideId":"a","guideSource":"bundled","completedAt":"2026-11-13T00:00:00Z","completionPercent":100}},{"metadata":{"name":"b"},"spec":{"userId":"user:b","guideId":"b","guideSource":"bundled","completedAt":"2026-11-13T00:00:00Z","completionPercent":100}}]}`))
	}))
	defer upstream.Close()
	store, err := resourceaccess.NewCompletionStore(sdkplugin.BuildClientGenerator(rest.Config{Host: upstream.URL, APIPath: "/apis"}))
	if err != nil {
		t.Fatal(err)
	}
	handler := completionReadHandler(store, false)
	for _, user := range []string{"a", "b", "a", "b"} {
		ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:" + user})
		recorder := httptest.NewRecorder()
		err := handler(ctx, recorder, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
		if err != nil {
			t.Fatal(err)
		}
		var response completionResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if !response.Capability.Available || response.UserID != "user:"+user || len(response.Completions) != 1 || response.Completions[0].GuideID != user || response.InProgress == nil {
			t.Fatalf("unexpected response: %s", recorder.Body.String())
		}
	}
	if calls != 2 {
		t.Fatalf("expected one refresh per caller, got %d", calls)
	}
	services.InvalidateCompletionIndex("default")
	ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:a"})
	if err := handler(ctx, httptest.NewRecorder(), &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("invalidation did not refresh: %d calls", calls)
	}
	ctx = authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:b"})
	if err := handler(ctx, httptest.NewRecorder(), &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	if calls != 4 {
		t.Fatalf("invalidation missed another caller: %d calls", calls)
	}
	deny = true
	ctx = authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:c"})
	recorder := httptest.NewRecorder()
	if err := handler(ctx, recorder, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	var denied completionResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &denied); err != nil {
		t.Fatal(err)
	}
	if denied.Capability.Available || len(denied.Completions) != 0 || calls != 5 {
		t.Fatalf("denied caller reused another caller's cache: %s", recorder.Body.String())
	}
}
