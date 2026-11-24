package resourceaccess

import (
	"context"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompletionStoreReadsCallerAcrossPages(t *testing.T) {
	calls := 0
	failSecond := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("continue") == "next" {
			if failSecond {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"kind":"Status","code":503}`))
				return
			}
			_, _ = w.Write([]byte(`{"items":[{"spec":{"userId":"caller","guideId":"second"}},{"spec":{"userId":"other","guideId":"private"}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[{"spec":{"userId":"caller","guideId":"first"}},{"spec":{"userId":"other","guideId":"private"}}]}`))
	}))
	defer server.Close()
	store, err := NewCompletionStore(sdkplugin.BuildClientGenerator(BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, GuidePageMaxBytes)))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := store.ReadCaller(context.Background(), "default", "caller")
	if err != nil || len(rows) != 2 || calls != 2 {
		t.Fatalf("rows=%+v calls=%d err=%v", rows, calls, err)
	}
	if rows[0].GuideID != "first" || rows[1].GuideID != "second" {
		t.Fatalf("wrong rows: %+v", rows)
	}
	failSecond = true
	rows, err = store.ReadCaller(context.Background(), "default", "caller")
	if err == nil || rows != nil {
		t.Fatalf("partial completion history escaped after failure: rows=%+v err=%v", rows, err)
	}
}
