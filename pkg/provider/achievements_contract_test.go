package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const achievementsTestBundleJSON = `{"grammar":"2.0","registry":{"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}],
    "sources":[{"interaction":"grafana_dashboard_created","emitter":"grafana","versions":">=13.2.0",
      "when":[{"property":"result","op":"eq","value":"success"}],
      "context":{"resourceId":"uid","numPanels":"numPanels"},"owner":"@grafana/dashboards-squad"}]}}},
  "guides":{"actions":{"completed":{
    "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},
               "guideCategory":{"type":"string","enum":["interactive","documentation","learning-journey"]}},
    "resources":[{"unit":"guide","id":["guideSource","guideId"]}]}}},
  "search":{"actions":{"performed":{"context":{}}}}
}},"catalog":{"achievements":[
  {"id":"dash-builder","title":"Dashboard builder","description":"Create dashboards.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
     {"id":"silver","goal":2,"rules":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
     {"id":"gold","goal":2,"rules":[{"entity":"dashboards","action":"created","countBy":"resource"}]}]},
  {"id":"guide-routes","title":"Guide routes","description":"Finish the named guide.",
   "tiers":[{"id":"intro","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideId","op":"eq","value":"intro"}]}]}]}
]}}`

const achievementsTestUser = "user:1"

// memAchievements is an in-memory Store and Reader, keyed by person.
type memAchievements struct {
	mu       sync.Mutex
	progress map[string]achievements.Progress
	awards   map[string]achievements.Award
	version  int

	loadErr, listErr error
	truncated        bool
}

func newMemAchievements() *memAchievements {
	return &memAchievements{progress: map[string]achievements.Progress{}, awards: map[string]achievements.Award{}}
}

func (m *memAchievements) put(p achievements.Person, row achievements.Progress) achievements.Progress {
	m.version++
	row.Version = strconv.Itoa(m.version)
	m.progress[p.ID+"/"+row.AchievementID] = row
	return row
}

func (m *memAchievements) LoadProgress(_ context.Context, p achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loadErr != nil {
		return nil, m.loadErr
	}
	out := map[string]achievements.Progress{}
	for _, id := range ids {
		if row, ok := m.progress[p.ID+"/"+id]; ok {
			out[id] = row
		}
	}
	return out, nil
}

func (m *memAchievements) CreateProgress(_ context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.progress[p.ID+"/"+row.AchievementID]; ok {
		return achievements.Progress{}, achievements.ErrExists
	}
	return m.put(p, row), nil
}

func (m *memAchievements) SaveProgress(_ context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.progress[p.ID+"/"+row.AchievementID].Version != row.Version {
		return achievements.Progress{}, achievements.ErrConflict
	}
	return m.put(p, row), nil
}

func (m *memAchievements) CreateAward(_ context.Context, p achievements.Person, a achievements.Award) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := p.ID + "/" + a.AchievementID + "/" + a.TierID
	if _, ok := m.awards[key]; ok {
		return achievements.ErrExists
	}
	m.awards[key] = a
	return nil
}

func (m *memAchievements) LoadAward(_ context.Context, p achievements.Person, achievementID, tierID string) (achievements.Award, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loadErr != nil {
		return achievements.Award{}, false, m.loadErr
	}
	a, ok := m.awards[p.ID+"/"+achievementID+"/"+tierID]
	return a, ok, nil
}

func (m *memAchievements) ListMine(_ context.Context, p achievements.Person) (achievements.Rows, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.listErr != nil {
		return achievements.Rows{}, m.listErr
	}
	rows := achievements.Rows{AsOf: achievementContractNow(), Truncated: m.truncated}
	for key, a := range m.awards {
		if strings.HasPrefix(key, p.ID+"/") {
			rows.Awards = append(rows.Awards, a)
		}
	}
	for key, row := range m.progress {
		if strings.HasPrefix(key, p.ID+"/") {
			rows.Progress = append(rows.Progress, row)
		}
	}
	return rows, nil
}

func achievementContractNow() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) }
func loadAchievementsTestBundle(t *testing.T, body string) *achievements.Snapshot {
	t.Helper()
	snapshot, err := achievements.LoadBundle([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

type achievementAllowAll struct{}

func (achievementAllowAll) Allow(context.Context, achievements.Person) error { return nil }
func captureAchievementValue(t *testing.T, value any) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	rr.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(rr).Encode(value); err != nil {
		t.Fatal(err)
	}
	return rr
}
func fixtureAchievementEvent(t *testing.T, mem *memAchievements, id, entity, action string, fields map[string]any) services.AchievementEventsResponse {
	t.Helper()
	defs := loadAchievementsTestBundle(t, achievementsTestBundleJSON)
	decisions, err := achievements.NewEvaluator(defs.Catalog, mem, achievementAllowAll{}, achievementContractNow).Evaluate(context.Background(), achievements.Person{ID: achievementsTestUser}, achievements.Event{ID: id, Entity: entity, Action: action, OccurredAt: achievementContractNow(), Context: fields})
	if err != nil {
		t.Fatal(err)
	}
	return services.AchievementEventsResponse{EventID: id, Retry: achievements.Retry(decisions), Decisions: decisions}
}
func fixtureDashboardEvent(t *testing.T, mem *memAchievements, i int) services.AchievementEventsResponse {
	return fixtureAchievementEvent(t, mem, fmt.Sprint("event-", i), "dashboards", "created", map[string]any{"resourceId": fmt.Sprint("uid-", i)})
}
func captureAchievementEventsTierUp(t *testing.T) *httptest.ResponseRecorder {
	mem := newMemAchievements()
	var response services.AchievementEventsResponse
	for i := range 3 {
		response = fixtureDashboardEvent(t, mem, i)
	}
	return captureAchievementValue(t, response)
}
func captureAchievementEventsMilestoneAward(t *testing.T) *httptest.ResponseRecorder {
	return captureAchievementValue(t, fixtureAchievementEvent(t, newMemAchievements(), "event-m", "guides", "completed", map[string]any{"guideSource": "bundled", "guideId": "intro"}))
}
func captureAchievementEventsNoSelection(t *testing.T) *httptest.ResponseRecorder {
	return captureAchievementValue(t, fixtureAchievementEvent(t, newMemAchievements(), "event-s", "search", "performed", nil))
}
func captureAchievementEventsRetry(t *testing.T) *httptest.ResponseRecorder {
	mem := newMemAchievements()
	mem.loadErr = fmt.Errorf("store down")
	return captureAchievementValue(t, fixtureAchievementEvent(t, mem, "event-r", "dashboards", "created", map[string]any{"resourceId": "uid-r"}))
}
func fixtureMyAchievements(t *testing.T, mem *memAchievements, user string) *httptest.ResponseRecorder {
	rows, err := mem.ListMine(context.Background(), achievements.Person{ID: user})
	if err != nil {
		t.Fatal(err)
	}
	response := services.ShapeMyAchievements(rows, loadAchievementsTestBundle(t, achievementsTestBundleJSON))
	response.Legacy = []services.LegacyBadge{}
	return captureAchievementValue(t, response)
}
func captureMyAchievementsDefault(t *testing.T) *httptest.ResponseRecorder {
	mem := newMemAchievements()
	for i := range 4 {
		fixtureDashboardEvent(t, mem, i)
	}
	fixtureAchievementEvent(t, mem, "event-m", "guides", "completed", map[string]any{"guideSource": "bundled", "guideId": "intro"})
	return fixtureMyAchievements(t, mem, achievementsTestUser)
}
func captureMyAchievementsEmpty(t *testing.T) *httptest.ResponseRecorder {
	return fixtureMyAchievements(t, newMemAchievements(), "user:nobody")
}
func captureMyAchievementsTruncated(t *testing.T) *httptest.ResponseRecorder {
	mem := newMemAchievements()
	mem.truncated = true
	fixtureDashboardEvent(t, mem, 0)
	return fixtureMyAchievements(t, mem, achievementsTestUser)
}
func captureMyAchievementsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	return captureAchievementValue(t, services.MyAchievementsResponse{Capability: services.AchievementCapability{Reason: "backend-unavailable"}, Awards: []services.AchievementAward{}, Progress: []services.AchievementProgress{}, Legacy: []services.LegacyBadge{}})
}

const achievementsTestBundleWithSkipJSON = `{"grammar":"2.0","registry":{"entities":{
  "guides":{"actions":{"completed":{"context":{"guideId":{"type":"string"}},
    "resources":[{"unit":"guide","id":["guideId"]}]}}},
  "dashboards":{"actions":{"created":{"context":{"resourceId":{"type":"string"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}],
    "sources":[{"interaction":"grafana_dashboard_created","emitter":"grafana","versions":">=13.2.0",
      "when":[{"property":"result","op":"in","value":["success","copied"]}],
      "context":{"resourceId":"uid"},"owner":"@grafana/dashboards-squad"}]}}}}},
 "catalog":{"achievements":[
  {"id":"guides-finished","title":"Guide finisher","description":"Finish guides.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}],"art":"guides-finished-1"},
     {"id":"silver","goal":4,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]}]},
  {"id":"guide-streak","title":"Guide streak","description":"Finish a guide every day.",
   "streak":{"days":3},"tiers":[{"id":"bronze","art":"guide-streak-1"}]}
 ]},
 "art":["guides-finished-1","guide-streak-1"]}`

func captureAchievementDefinitionsDefault(t *testing.T) *httptest.ResponseRecorder {
	defs := loadAchievementsTestBundle(t, achievementsTestBundleWithSkipJSON)
	return achievementRequest(t, "definitions", "user:1", "default", "default", "", testAchievementDefinitions{defs})
}

func TestMyAchievementsShowsPointsTowardTheLowestUnheldTier(t *testing.T) {
	progressOf := func(t *testing.T, mem *memAchievements) (services.MyAchievementsResponse, services.AchievementProgress) {
		t.Helper()
		rows, err := mem.ListMine(context.Background(), achievements.Person{ID: achievementsTestUser})
		if err != nil {
			t.Fatal(err)
		}
		body := services.ShapeMyAchievements(rows, loadAchievementsTestBundle(t, achievementsTestBundleJSON))
		for _, p := range body.Progress {
			if p.AchievementID == "dash-builder" {
				return body, p
			}
		}
		t.Fatalf("progress = %+v, want a dash-builder row", body.Progress)
		return body, services.AchievementProgress{}
	}

	t.Run("a point toward silver", func(t *testing.T) {
		mem := newMemAchievements()
		for i := range 2 {
			fixtureDashboardEvent(t, mem, i)
		}
		if _, p := progressOf(t, mem); p.Units != 1 || p.Next == nil || *p.Next != 2 {
			t.Fatalf("progress = %+v, want 1 of silver's 2", p)
		}
	})
	t.Run("every tier held", func(t *testing.T) {
		mem := newMemAchievements()
		for i := range 5 {
			fixtureDashboardEvent(t, mem, i)
		}
		body, p := progressOf(t, mem)
		if p.Units != 0 || p.Next != nil || len(body.Awards) != 3 {
			t.Fatalf("progress = %+v awards = %+v, want all three tiers and no next", p, body.Awards)
		}
	})
	t.Run("a tier awarded before the row recorded it", func(t *testing.T) {
		mem := newMemAchievements()
		mem.put(achievements.Person{ID: achievementsTestUser}, achievements.Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: []string{"u1", "u2"}, Points: 1, SchemaVersion: achievements.ProgressSchemaVersion})
		for _, tier := range []string{"bronze", "silver"} {
			mem.awards[achievementsTestUser+"/dash-builder/"+tier] = achievements.Award{AchievementID: "dash-builder", TierID: tier, Entity: "dashboards", EarnedAt: achievementContractNow()}
		}
		if _, p := progressOf(t, mem); p.Next == nil || *p.Next != 2 || p.Units != 0 {
			t.Fatalf("progress = %+v, want gold's goal of 2 and none of the point the row holds toward silver", p)
		}
	})
}
