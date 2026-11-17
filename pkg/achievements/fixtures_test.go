package achievements

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testRegistryJSON = `{"entities":{
  "dashboards":{"actions":{"created":{
    "context":{"resourceId":{"type":"string"},"numPanels":{"type":"number"},"starred":{"type":"boolean"}},
    "resources":[{"unit":"dashboard","id":["resourceId"]}]}}},
  "guides":{"actions":{"completed":{
    "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},
               "guideCategory":{"type":"string","enum":["interactive","documentation","learning-journey"]}},
    "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]}}},
  "alert-rules":{"actions":{"created":{"context":{}}}},
  "folders":{"actions":{"created":{"context":{"folderUid":{"type":"string"}},"resources":[{"unit":"folder","id":["folderUid"]}]}}},
  "contact-points":{"actions":{"created":{"context":{}}}}
}}`

const testCatalogJSON = `{"achievements":[
  {"id":"dash-builder","title":"Dashboard builder","description":"Create dashboards.",
   "tiers":[
     {"id":"bronze","goal":1,"art":"dash-1","rules":[
        {"entity":"dashboards","action":"created","countBy":"resource","where":[{"field":"numPanels","op":"gte","value":1}]},
        {"entity":"guides","action":"completed","countBy":"resource","where":[
          {"field":"guideSource","op":"eq","value":"bundled"},{"field":"guideId","op":"eq","value":"first-dashboard-cloud"}]}]},
     {"id":"silver","goal":4,"art":"dash-2","rules":[
        {"entity":"dashboards","action":"created","countBy":"resource","where":[{"field":"numPanels","op":"gte","value":1}]}]},
     {"id":"gold","goal":10,"art":"dash-3","rules":[
        {"entity":"dashboards","action":"created","countBy":"resource","where":[{"field":"numPanels","op":"gte","value":3}]},
        {"entity":"dashboards","action":"created","countBy":"resource","worth":2,"where":[
          {"field":"numPanels","op":"gte","value":3},{"field":"starred","op":"eq","value":true}]}]}]},
  {"id":"well-rounded","title":"Well rounded","description":"Finish guides of different kinds.",
   "tiers":[
     {"id":"bronze","goal":2,"rules":[{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]},
     {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]}]},
  {"id":"alert-starter","title":"Alert starter","description":"Create alert rules.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},
     {"id":"silver","goal":2,"rules":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]}]},
  {"id":"journey","title":"Journey","description":"Make folders, then contact points, then finish the journey.",
   "tiers":[
     {"id":"builder","goal":3,"rules":[{"entity":"folders","action":"created","countBy":"resource"}]},
     {"id":"watcher","goal":2,"rules":[{"entity":"contact-points","action":"created","countBy":"occurrence"}]},
     {"id":"capstone","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource","where":[
        {"field":"guideId","op":"eq","value":"observability-journey"}]}]}]},
  {"id":"guide-routes","title":"Guide routes","description":"Finish the named guides.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideId","op":"eq","value":"intro"}]}]},
     {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource","where":[{"field":"guideId","op":"in","value":["advanced","expert"]}]}]}]}
]}`

var fixedNow = time.Date(2026, 11, 2, 9, 30, 0, 0, time.FixedZone("test", 3600))

func mustRegistry(t testing.TB) *Registry {
	t.Helper()
	r, err := loadRegistry([]byte(testRegistryJSON))
	if err != nil {
		t.Fatalf("test registry: %v", err)
	}
	return r
}

func mustCatalog(t testing.TB) *Catalog {
	t.Helper()
	c, err := loadCatalog([]byte(testCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatalf("test catalog: %v", err)
	}
	return c
}

func dashboardCreated(uid string, panels float64) Event {
	return Event{ID: "evt-" + uid, Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": uid, "numPanels": panels}}
}

func starredDashboard(uid string, panels float64) Event {
	ev := dashboardCreated(uid, panels)
	ev.Context["starred"] = true
	return ev
}

func guideCompleted(id, category string) Event {
	return Event{ID: "evt-" + id, Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": "bundled", "guideId": id, "guideCategory": category}}
}

func alertCreated(eventID string) Event {
	return Event{ID: eventID, Entity: "alert-rules", Action: "created"}
}

func folderCreated(uid string) Event {
	return Event{ID: "evt-" + uid, Entity: "folders", Action: "created", Context: map[string]any{"folderUid": uid}}
}

func contactPointCreated(eventID string) Event {
	return Event{ID: eventID, Entity: "contact-points", Action: "created"}
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

func unitKey(unit string, parts ...string) string {
	var key strings.Builder
	key.WriteString(unit)
	key.WriteByte(':')
	for _, p := range parts {
		key.WriteString(strconv.Itoa(len(p)))
		key.WriteByte(':')
		key.WriteString(p)
	}
	return key.String()
}

func dash(uids ...string) []string {
	keys := make([]string, len(uids))
	for i, uid := range uids {
		keys[i] = unitKey("dashboard", uid)
	}
	return keys
}

func occurrences(ids ...string) []string {
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = unitKey(unitOccurrence, id)
	}
	return keys
}

type fakeStore struct {
	progress map[string]Progress
	awards   map[string]Award
	version  int

	loadErr, createProgressErr, saveErr, awardErr error
	// awardErrFor fails CreateAward for the "achievement/tier" keys it holds.
	awardErrFor map[string]error
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
	key := a.AchievementID + "/" + a.TierID
	if err := s.awardErrFor[key]; err != nil {
		return err
	}
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
