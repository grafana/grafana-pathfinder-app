package achievements

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"
)

const testRegistryJSON = `{"schemaVersion":1,"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"},"starred":{"type":"boolean"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}]}}},
  "guides":{"actions":{"completed":{
    "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},
               "guideCategory":{"type":"string","enum":["interactive","documentation","learning-journey"]}},
    "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]}}},
  "alert-rules":{"actions":{"created":{"context":{}}}}
}}`

const testCatalogJSON = `{"schemaVersion":1,"achievements":[
  {"id":"dash-builder","revision":1,"title":"Dashboard builder","description":"Create dashboards.",
   "counter":{"unit":"dashboard","evidence":[
     {"entity":"dashboards","action":"created","countBy":"resource","where":[{"field":"numPanels","op":"gte","value":1}]}]},
   "tiers":[
     {"tier":1,"at":1,"art":"dash-1","or":[{"entity":"guides","action":"completed","where":[
        {"field":"guideSource","op":"eq","value":"bundled"},{"field":"guideId","op":"eq","value":"first-dashboard-cloud"}]}]},
     {"tier":2,"at":5,"art":"dash-2"},
     {"tier":3,"at":25,"art":"dash-3"}]},
  {"id":"well-rounded","revision":1,"title":"Well rounded","description":"Finish guides of different kinds.",
   "counter":{"unit":"guide-category","evidence":[
     {"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]},
   "tiers":[{"tier":1,"at":2},{"tier":2,"at":3}]},
  {"id":"alert-starter","revision":2,"title":"Alert starter","description":"Create alert rules.",
   "counter":{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},
   "tiers":[{"tier":1,"at":1},{"tier":2,"at":3}]},
  {"id":"guide-routes","revision":1,"title":"Guide routes","description":"Finish the named guides.",
   "tiers":[
     {"tier":1,"or":[{"entity":"guides","action":"completed","where":[{"field":"guideId","op":"eq","value":"intro"}]}]},
     {"tier":2,"or":[{"entity":"guides","action":"completed","where":[{"field":"guideId","op":"in","value":["advanced","expert"]}]}]}]}
]}`

var fixedNow = time.Date(2026, 11, 2, 9, 30, 0, 0, time.FixedZone("test", 3600))

func mustRegistry(t testing.TB) *Registry {
	t.Helper()
	r, err := LoadRegistry([]byte(testRegistryJSON))
	if err != nil {
		t.Fatalf("test registry: %v", err)
	}
	return r
}

func mustCatalog(t testing.TB) *Catalog {
	t.Helper()
	c, err := LoadCatalog([]byte(testCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatalf("test catalog: %v", err)
	}
	return c
}

func dashboardCreated(uid string, panels float64) Event {
	return Event{ID: "evt-" + uid, Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": uid, "numPanels": panels}}
}

func guideCompleted(id, category string) Event {
	return Event{ID: "evt-" + id, Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": "bundled", "guideId": id, "guideCategory": category}}
}

func alertCreated(eventID string) Event {
	return Event{ID: eventID, Entity: "alert-rules", Action: "created"}
}

func decisionJSON(t testing.TB, d any) string {
	t.Helper()
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func intp(n int) *int { return &n }

type fakeStore struct {
	progress map[string]Progress
	awards   map[string]Award
	version  int

	loadErr, createProgressErr, saveErr, awardErr error
	// beforeSave runs at the start of each SaveProgress, to model another replica writing first.
	beforeSave func(s *fakeStore, attempt int)

	loads, creates, saves, awardCalls int
}

func newFakeStore() *fakeStore {
	return &fakeStore{progress: map[string]Progress{}, awards: map[string]Award{}}
}

func (s *fakeStore) seed(p Progress) {
	s.version++
	p.Version = strconv.Itoa(s.version)
	s.progress[p.AchievementID] = p
}

func (s *fakeStore) calls() int { return s.loads + s.creates + s.saves + s.awardCalls }

func (s *fakeStore) LoadProgress(_ context.Context, _ Person, ids []string) (map[string]Progress, error) {
	s.loads++
	if s.loadErr != nil {
		return nil, s.loadErr
	}
	out := map[string]Progress{}
	for _, id := range ids {
		if p, ok := s.progress[id]; ok {
			out[id] = p
		}
	}
	return out, nil
}

func (s *fakeStore) CreateProgress(_ context.Context, _ Person, p Progress) (Progress, error) {
	s.creates++
	if s.createProgressErr != nil {
		return Progress{}, s.createProgressErr
	}
	if _, ok := s.progress[p.AchievementID]; ok {
		return Progress{}, ErrExists
	}
	s.seed(p)
	return s.progress[p.AchievementID], nil
}

func (s *fakeStore) SaveProgress(_ context.Context, _ Person, p Progress) (Progress, error) {
	s.saves++
	if s.beforeSave != nil {
		s.beforeSave(s, s.saves)
	}
	if s.saveErr != nil {
		return Progress{}, s.saveErr
	}
	if s.progress[p.AchievementID].Version != p.Version {
		return Progress{}, ErrConflict
	}
	s.seed(p)
	return s.progress[p.AchievementID], nil
}

func (s *fakeStore) CreateAward(_ context.Context, _ Person, a Award) error {
	s.awardCalls++
	if s.awardErr != nil {
		return s.awardErr
	}
	key := fmt.Sprintf("%s/%d", a.AchievementID, a.Tier)
	if _, ok := s.awards[key]; ok {
		return ErrExists
	}
	s.awards[key] = a
	return nil
}

type fakePolicy struct {
	err   error
	calls int
}

func (p *fakePolicy) Allow(context.Context, Person) error {
	p.calls++
	return p.err
}
