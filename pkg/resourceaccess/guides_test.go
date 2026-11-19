package resourceaccess

import (
	"context"
	"errors"
	"github.com/grafana/grafana-app-sdk/resource"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

func TestGuideStoreDrainsSDKPagesWithoutDroppingFields(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Query().Get("limit") != "100" {
			t.Error("missing page limit")
		}
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[{"metadata":{"name":"one"},"spec":{"future":true}}]}`))
		} else {
			if r.URL.Query().Get("continue") != "next" {
				t.Error("missing continuation")
			}
			_, _ = w.Write([]byte(`{"metadata":{},"items":[{"metadata":{"name":"two"},"spec":{"future":false}}]}`))
		}
	}))
	defer server.Close()
	store, err := NewGuideStore(sdkplugin.BuildClientGenerator(BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, GuidePageMaxBytes)))
	if err != nil {
		t.Fatal(err)
	}
	items, err := services.ReadGuideResources(context.Background(), "default", 32*1024*1024, 50000, store.ListPage, func(int, int64) { t.Fatal("unexpected truncation") })
	if err != nil || len(items) != 2 || calls != 2 {
		t.Fatalf("items=%s calls=%d error=%v", items, calls, err)
	}
	if string(items[0]) != `{"metadata":{"name":"one"},"spec":{"future":true}}` {
		t.Fatalf("changed guide: %s", items[0])
	}
}

func TestGuidePageRetriesOverflowAtSameCursor(t *testing.T) {
	var limits []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limits = append(limits, q.Get("limit"))
		if q.Get("continue") != "cursor" {
			t.Errorf("lost cursor: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		if q.Get("limit") == "100" {
			_, _ = w.Write([]byte(strings.Repeat(" ", 256)))
			return
		}
		_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[]}`))
	}))
	defer server.Close()
	store, err := NewGuideStore(sdkplugin.BuildClientGenerator(BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, 128)))
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.ListPage(context.Background(), "default", "cursor")
	if err != nil || page.Continue != "next" || !slices.Equal(limits, []string{"100", "50"}) {
		t.Fatalf("limits=%v next=%q err=%v", limits, page.Continue, err)
	}
}

type slowOverflowClient struct{ resource.Client }

func (slowOverflowClient) ListInto(ctx context.Context, _ string, options resource.ListOptions, _ resource.ListObject) error {
	delay := time.Second
	if options.Limit == 100 {
		delay = 14500 * time.Millisecond
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(delay):
	}
	if options.Limit == 100 {
		return &ResponseValidationError{Reason: "response-too-large", Status: 200}
	}
	return nil
}

func TestSlowGuideOverflowGetsFreshAttemptWithinDrainDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		store := GuideStore{client: slowOverflowClient{}}
		for _, budget := range []time.Duration{60 * time.Second, 15 * time.Second} {
			ctx, cancel := context.WithTimeout(context.Background(), budget)
			_, err := store.ListPage(ctx, "default", "same-cursor")
			cancel()
			if budget == 60*time.Second && err != nil {
				t.Fatalf("smaller retry failed: %v", err)
			}
			if budget == 15*time.Second && !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("aggregate deadline lost: %v", err)
			}
		}
	})
}
