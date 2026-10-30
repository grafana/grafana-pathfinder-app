package achievements

import (
	"encoding/json"
	"testing"
)

func TestEvaluateGolden(t *testing.T) {
	catalog := mustCatalog(t)
	defs := map[string]*Definition{}
	for i := range catalog.Achievements {
		defs[catalog.Achievements[i].ID] = &catalog.Achievements[i]
	}

	cases := []struct {
		name        string
		id          string
		stored      Progress
		event       Event
		want        string
		wantChanged bool
		wantUnits   []string
	}{
		{
			name: "first unit awards tier 1",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: dashboardCreated("a", 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":0,"to":1,"final":false,"units":1,"next":5,"revision":1}`,
			wantChanged: true, wantUnits: []string{"a"},
		},
		{
			name: "new unit below the next threshold increments",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"a"}, Revision: 1}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":1,"to":1,"final":false,"units":2,"next":5,"revision":1}`,
			wantChanged: true, wantUnits: []string{"a", "b"},
		},
		{
			name: "reaching a threshold above tier 0 is a tier_up",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"a", "b", "c", "d"}, Revision: 1}, event: dashboardCreated("e", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":1,"to":2,"final":false,"units":5,"next":25,"revision":1}`,
			wantChanged: true, wantUnits: []string{"a", "b", "c", "d", "e"},
		},
		{
			name: "reaching the last tier is an award, final, with no next",
			id:   "well-rounded", stored: Progress{Tier: 1, Units: []string{"documentation", "interactive"}, Revision: 1}, event: guideCompleted("x", "learning-journey"),
			want:        `{"achievementId":"well-rounded","decision":"award","from":1,"to":2,"final":true,"units":3,"next":null,"revision":1}`,
			wantChanged: true, wantUnits: []string{"documentation", "interactive", "learning-journey"},
		},
		{
			name: "the last occurrence tier is a final award",
			id:   "alert-starter", stored: Progress{Tier: 1, Units: []string{"e1", "e2"}, Revision: 2}, event: alertCreated("e3"),
			want:        `{"achievementId":"alert-starter","decision":"award","from":1,"to":2,"final":true,"units":3,"next":null,"revision":2}`,
			wantChanged: true, wantUnits: []string{"e1", "e2", "e3"},
		},
		{
			name: "unit already in the ledger is a duplicate",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"a"}, Revision: 1}, event: dashboardCreated("a", 3),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"duplicate","from":1,"to":1,"final":false,"units":1,"next":5,"revision":1}`,
		},
		{
			name: "earned final tier is complete",
			id:   "well-rounded", stored: Progress{Tier: 2, Units: []string{"documentation", "interactive", "learning-journey"}, Revision: 1}, event: guideCompleted("x", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"complete","from":2,"to":2,"final":true,"units":3,"next":null,"revision":1}`,
		},
		{
			name: "newer schema record is untouched",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"a"}, Revision: 1, SchemaVersion: SchemaVersion + 1}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","from":1,"to":1,"final":false,"units":1,"next":5,"revision":1}`,
		},
		{
			name: "where that fails is condition_not_met",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: dashboardCreated("a", 0),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "a field the event lacks is condition_not_met",
			id:   "dash-builder", stored: Progress{Revision: 1},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "a field of the wrong type fails its condition",
			id:   "dash-builder", stored: Progress{Revision: 1},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a", "numPanels": "2"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "missing unit id is invalid_context",
			id:   "dash-builder", stored: Progress{Revision: 1},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"numPanels": 2.0}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "empty unit id is invalid_context",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: dashboardCreated("", 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "a compound unit id is invalid when one part is missing",
			id:   "well-rounded", stored: Progress{Revision: 1},
			event: Event{ID: "e", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": "bundled"}},
			want:  `{"achievementId":"well-rounded","decision":"ignored","reason":"invalid_context","from":0,"to":0,"final":false,"units":0,"next":2,"revision":1}`,
		},
		{
			name: "unit id over 128 bytes is invalid_context",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: dashboardCreated(string(make([]byte, 129)), 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":0,"to":0,"final":false,"units":0,"next":1,"revision":1}`,
		},
		{
			name: "unit id of exactly 128 bytes counts",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: dashboardCreated(string(repeatByte('x', 128)), 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":0,"to":1,"final":false,"units":1,"next":5,"revision":1}`,
			wantChanged: true, wantUnits: []string{string(repeatByte('x', 128))},
		},
		{
			name: "a route earns its tier outright",
			id:   "dash-builder", stored: Progress{Revision: 1}, event: guideCompleted("first-dashboard-cloud", "interactive"),
			want:        `{"achievementId":"dash-builder","decision":"award","from":0,"to":1,"final":false,"units":0,"next":5,"revision":1}`,
			wantChanged: true, wantUnits: nil,
		},
		{
			name: "a route to a higher tier earns every lower one",
			id:   "guide-routes", stored: Progress{Revision: 1}, event: guideCompleted("expert", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":0,"to":2,"final":true,"units":0,"next":null,"revision":1}`,
			wantChanged: true,
		},
		{
			name: "a route to the last milestone tier is a final award",
			id:   "guide-routes", stored: Progress{Tier: 1, Revision: 1}, event: guideCompleted("advanced", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":1,"to":2,"final":true,"units":0,"next":null,"revision":1}`,
			wantChanged: true,
		},
		{
			name: "a route to a tier already held is a duplicate",
			id:   "guide-routes", stored: Progress{Tier: 1, Revision: 1}, event: guideCompleted("intro", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"duplicate","from":1,"to":1,"final":false,"units":0,"next":null,"revision":1}`,
		},
		{
			name: "a route whose where fails is condition_not_met",
			id:   "guide-routes", stored: Progress{Revision: 1}, event: guideCompleted("other", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"condition_not_met","from":0,"to":0,"final":false,"units":0,"next":null,"revision":1}`,
		},
		{
			name: "occurrence counts the event id and a replay adds nothing",
			id:   "alert-starter", stored: Progress{Tier: 1, Units: []string{"e1"}, Revision: 2}, event: alertCreated("e1"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","from":1,"to":1,"final":false,"units":1,"next":3,"revision":2}`,
		},
		{
			name: "occurrence with an empty event id is invalid_context",
			id:   "alert-starter", stored: Progress{Revision: 2}, event: alertCreated(""),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"invalid_context","from":0,"to":0,"final":false,"units":0,"next":1,"revision":2}`,
		},
		{
			name: "a named resource counts its own unit, so a second guide of one category is a duplicate",
			id:   "well-rounded", stored: Progress{Revision: 1, Units: []string{"interactive"}}, event: guideCompleted("other-guide", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","from":0,"to":0,"final":false,"units":1,"next":2,"revision":1}`,
		},
		{
			name: "a lowered threshold applies on a duplicate event",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"a", "b", "c", "d", "e"}, Revision: 1}, event: dashboardCreated("a", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":1,"to":2,"final":false,"units":5,"next":25,"revision":1}`,
			wantChanged: true, wantUnits: []string{"a", "b", "c", "d", "e"},
		},
		{
			name: "a revision behind the catalog is updated with no recount",
			id:   "alert-starter", stored: Progress{Tier: 1, Units: []string{"e1"}, Revision: 1}, event: alertCreated("e1"),
			want:        `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","from":1,"to":1,"final":false,"units":1,"next":3,"revision":2}`,
			wantChanged: true, wantUnits: []string{"e1"},
		},
		{
			name: "a lower catalog revision never lowers the stored one",
			id:   "alert-starter", stored: Progress{Tier: 1, Units: []string{"e1"}, Revision: 5}, event: alertCreated("e2"),
			want:        `{"achievementId":"alert-starter","decision":"increment","from":1,"to":1,"final":false,"units":2,"next":3,"revision":5}`,
			wantChanged: true, wantUnits: []string{"e1", "e2"},
		},
		{
			name: "the ledger is kept sorted and distinct",
			id:   "dash-builder", stored: Progress{Tier: 1, Units: []string{"b", "d"}, Revision: 1}, event: dashboardCreated("c", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":1,"to":1,"final":false,"units":3,"next":5,"revision":1}`,
			wantChanged: true, wantUnits: []string{"b", "c", "d"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stored := tc.stored
			stored.AchievementID = tc.id
			got := evaluate(defs[tc.id], stored, tc.event)
			if j := decisionJSON(t, got.decision); j != tc.want {
				t.Errorf("decision\n got %s\nwant %s", j, tc.want)
			}
			if got.changed != tc.wantChanged {
				t.Errorf("changed = %v, want %v", got.changed, tc.wantChanged)
			}
			if got.changed && tc.wantUnits != nil && !equalStrings(got.next.Units, tc.wantUnits) {
				t.Errorf("units = %v, want %v", got.next.Units, tc.wantUnits)
			}
			if got.changed && got.next.Tier != got.decision.To {
				t.Errorf("persisted tier %d != decision to %d", got.next.Tier, got.decision.To)
			}
		})
	}
}

func TestEvaluateDoesNotMutateStoredLedger(t *testing.T) {
	catalog := mustCatalog(t)
	stored := Progress{AchievementID: "dash-builder", Tier: 1, Units: []string{"a", "c"}, Revision: 1}
	evaluate(&catalog.Achievements[0], stored, dashboardCreated("b", 1))
	if !equalStrings(stored.Units, []string{"a", "c"}) {
		t.Errorf("stored ledger mutated: %v", stored.Units)
	}
}

func TestEvaluateLedgerStopsAtTopThreshold(t *testing.T) {
	registry := mustRegistry(t)
	catalog, err := LoadCatalog([]byte(`{"schemaVersion":1,"achievements":[
	  {"id":"small","revision":1,"title":"Small","description":"Small.",
	   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
	   "tiers":[{"tier":1,"at":1},{"tier":2,"at":2}]}]}`), registry)
	if err != nil {
		t.Fatal(err)
	}
	stored := Progress{AchievementID: "small", Tier: 1, Units: []string{"a", "b"}, Revision: 1}
	got := evaluate(&catalog.Achievements[0], stored, dashboardCreated("c", 1))
	if !equalStrings(got.next.Units, []string{"a", "b"}) || got.decision.To != 2 || got.decision.Units != 2 {
		t.Errorf("ledger grew past the top threshold: %+v units=%v", got.decision, got.next.Units)
	}
}

func repeatByte(b byte, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = b
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestConditionHolds(t *testing.T) {
	cases := []struct {
		name  string
		cond  Condition
		value any
		want  bool
	}{
		{"eq string", Condition{Op: "eq", Value: "a"}, "a", true},
		{"eq string differs", Condition{Op: "eq", Value: "a"}, "b", false},
		{"eq number against an int", Condition{Op: "eq", Value: 2.0}, 2, true},
		{"eq number against a string", Condition{Op: "eq", Value: 2.0}, "2", false},
		{"eq bool", Condition{Op: "eq", Value: true}, true, true},
		{"eq bool differs", Condition{Op: "eq", Value: true}, false, false},
		{"eq bool against a string", Condition{Op: "eq", Value: true}, "true", false},
		{"in holds for any member", Condition{Op: "in", Value: []any{"a", "b"}}, "b", true},
		{"in holds for none", Condition{Op: "in", Value: []any{"a", "b"}}, "c", false},
		{"gte equal", Condition{Op: "gte", Value: 3.0}, 3.0, true},
		{"gte below", Condition{Op: "gte", Value: 3.0}, 2.0, false},
		{"gte against a string", Condition{Op: "gte", Value: 3.0}, "9", false},
		{"lte equal", Condition{Op: "lte", Value: 3.0}, 3, true},
		{"lte above", Condition{Op: "lte", Value: 3.0}, int64(4), false},
		{"unknown op never holds", Condition{Op: "neq", Value: 3.0}, 4.0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cond.holds(tc.value); got != tc.want {
				t.Errorf("holds = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCatalogRoundTripsThroughJSON(t *testing.T) {
	registry := mustRegistry(t)
	catalog := mustCatalog(t)
	out, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	again, err := LoadCatalog(out, registry)
	if err != nil {
		t.Fatalf("re-loading a marshalled catalog: %v", err)
	}
	if rulesJSON(&catalog.Achievements[0]) != rulesJSON(&again.Achievements[0]) {
		t.Error("catalog changed across a marshal and load")
	}
}
