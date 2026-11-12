package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

func dashboardSourceBody(eventID, uid, result string) string {
	return fmt.Sprintf(`{"schemaVersion":1,"eventId":%q,"source":"grafana_dashboard_created","occurredAt":%q,"properties":{"uid":%q,"numPanels":2,"result":%q}}`,
		eventID, timeNow().UTC().Format(time.RFC3339), uid, result)
}

func decodeEventsResponse(t *testing.T, body []byte) achievementEventsResponse {
	t.Helper()
	var resp achievementEventsResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode: %v (raw: %s)", err, body)
	}
	return resp
}

func TestAchievementEvent_MapsASourceEventToItsPair(t *testing.T) {
	mem := newMemAchievements()
	app := newAchievementsTestApp(t, mem)

	rr := postAchievementEvent(t, app, achievementsTestUser, dashboardSourceBody("echo-1", "uid-1", "success"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	resp := decodeEventsResponse(t, rr.Body.Bytes())
	if resp.EventID != "echo-1" || len(resp.Decisions) != 1 || resp.Decisions[0].Decision != achievements.KindAward {
		t.Fatalf("response = %+v", resp)
	}
	award := mem.awards[achievementsTestUser+"/dash-builder/bronze"]
	if award.Entity != "dashboards" {
		t.Errorf("award = %+v, want it stamped with the mapped entity", award)
	}

	rr = postAchievementEvent(t, app, achievementsTestUser, dashboardEventBody("pair-1", "uid-1"))
	if d := decodeEventsResponse(t, rr.Body.Bytes()).Decisions; len(d) != 1 || d[0].Reason != achievements.ReasonDuplicate {
		t.Errorf("the pair-shaped event for the same dashboard = %+v, want a duplicate", d)
	}
}

func TestAchievementEvent_ASourceVariantOutsideWhenCountsNothing(t *testing.T) {
	mem := newMemAchievements()
	rr := postAchievementEvent(t, newAchievementsTestApp(t, mem), achievementsTestUser, dashboardSourceBody("echo-f", "uid-1", "failure"))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	resp := decodeEventsResponse(t, rr.Body.Bytes())
	if resp.EventID != "echo-f" || resp.Retry || resp.Decisions == nil || len(resp.Decisions) != 0 {
		t.Fatalf("response = %s, want an empty decisions array the client drops", rr.Body.String())
	}
	if awards, progress := mem.rowsFor(achievementsTestUser); awards+progress != 0 {
		t.Error("an uncounted variant reached the store")
	}
}

func definitionsForStack(t *testing.T, version string) achievementDefinitionsResponse {
	t.Helper()
	app, _ := appWithDefinitions(t, achievementsTestBundleWithSkipJSON)
	r := completionRequestWithConfig(t, achievementsRoutePrefix+"/definitions", achievementsTestUser, testGrafanaConfig())
	if version != "" {
		ua, err := useragent.New(version, "linux", "amd64")
		if err != nil {
			t.Fatal(err)
		}
		r = r.WithContext(useragent.WithUserAgent(r.Context(), ua))
	}
	rr := httptest.NewRecorder()
	app.handleAchievementDefinitions(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var resp achievementDefinitionsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
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

func TestAchievementDefinitions_ASourceWithNoMappingIsAnEmptyPropertyList(t *testing.T) {
	bundle := strings.Replace(achievementsTestBundleJSON, `"search":{"actions":{"performed":{"context":{}}}}`,
		`"search":{"actions":{"performed":{"context":{},"sources":[{"interaction":"grafana_search_performed","emitter":"grafana","versions":">=13.2.0","owner":"@grafana/search-squad"}]}}}`, 1)
	app, _ := appWithDefinitions(t, bundle)
	rr := getAchievementDefinitions(t, app, achievementsTestUser, testGrafanaConfig())
	if !strings.Contains(rr.Body.String(), `{"interaction":"grafana_search_performed","properties":[]}`) {
		t.Fatalf("body = %s, want an empty properties array the browser can parse", rr.Body.String())
	}
}

func TestAchievementDefinitions_EarnabilityFollowsTheStackVersion(t *testing.T) {
	app, _ := appWithDefinitions(t, achievementsTestBundleJSON)
	for version, want := range map[string]bool{"13.1.0": false, "13.2.0": true} {
		r := completionRequestWithConfig(t, achievementsRoutePrefix+"/definitions", achievementsTestUser, testGrafanaConfig())
		ua, err := useragent.New(version, "linux", "amd64")
		if err != nil {
			t.Fatal(err)
		}
		rr := httptest.NewRecorder()
		app.handleAchievementDefinitions(rr, r.WithContext(useragent.WithUserAgent(r.Context(), ua)))
		var resp achievementDefinitionsResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		earnable := map[string]bool{}
		for _, d := range resp.Achievements {
			earnable[d.ID] = d.Earnable
		}
		if earnable["dash-builder"] != want || !earnable["guide-routes"] {
			t.Errorf("Grafana %s: earnable = %v, want dash-builder %v and guide-routes true", version, earnable, want)
		}
	}
}
