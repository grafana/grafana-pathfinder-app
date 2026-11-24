package provider

import (
	"context"
	"encoding/json"
	"fmt"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func definitionsForStack(t *testing.T, version string) achievementDefinitionsResponse {
	t.Helper()
	defs := testAchievementDefinitions{loadAchievementsTestBundle(t, achievementsTestBundleWithSkipJSON)}
	ctx := authlib.WithAuthInfo(context.Background(), writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}})
	req := &app.CustomRouteRequest{Method: http.MethodGet, URL: &url.URL{RawQuery: url.Values{"grafanaVersion": {version}}.Encode()}, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}
	rr := httptest.NewRecorder()
	if err := achievementHandler(nil, defs, "definitions")(ctx, rr, req); err != nil {
		t.Fatal(err)
	}
	var resp achievementDefinitionsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil || rr.Code != 200 {
		t.Fatalf("definitions: %d %s (%v)", rr.Code, rr.Body, err)
	}
	return resp
}

func TestAchievementDefinitions_ListsTheSourcesTheStackEmits(t *testing.T) {
	for version, want := range map[string]int{"": 1, "13.2.0-90577": 1, "14.0.1": 1, "13.1.4": 0} {
		resp := definitionsForStack(t, version)
		if resp.Sources == nil || len(resp.Sources) != want {
			t.Errorf("Grafana %q: sources = %+v, want %d", version, resp.Sources, want)
			continue
		}
		if want == 1 {
			got := resp.Sources[0]
			if got.Interaction != "grafana_dashboard_created" || fmt.Sprint(got.Properties) != "[result uid]" || len(got.When) != 1 {
				t.Errorf("Grafana %q: source = %+v", version, got)
			}
		}
	}
}

func TestUncountedSourceEventSkipsStorage(t *testing.T) {
	defs := testAchievementDefinitions{loadAchievementsTestBundle(t, achievementsTestBundleJSON)}
	body := fmt.Sprintf(`{"schemaVersion":1,"eventId":"echo-f","source":"grafana_dashboard_created","occurredAt":%q,"properties":{"uid":"uid-1","numPanels":2,"result":"failure"}}`, time.Now().UTC().Format(time.RFC3339))
	rr := achievementRequest(t, "events", "user:1", "default", "default", body, defs)
	var resp services.AchievementEventsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil || rr.Code != 200 || resp.EventID != "echo-f" || resp.Retry || resp.Decisions == nil || len(resp.Decisions) != 0 {
		t.Fatalf("event: %d %s (%v)", rr.Code, rr.Body, err)
	}
}
