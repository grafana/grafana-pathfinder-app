package achievements

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"
)

func TestEvaluateGolden(t *testing.T) {
	catalog := mustCatalog(t)
	defs := map[string]*Definition{}
	for i := range catalog.Achievements {
		defs[catalog.Achievements[i].ID] = &catalog.Achievements[i]
	}
	capCount := string(repeatByte('x', maxUnitIDBytes-len("516:")))

	cases := []struct {
		name        string
		id          string
		stored      Progress
		event       Event
		want        string
		wantChanged bool
		wantUnits   []string
		wantPoints  int
		wantHeld    []string
	}{
		{
			name: "the first unit earns the lowest tier",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 2),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":4}`,
			wantChanged: true, wantUnits: dash("a"),
		},
		{
			name: "a new unit below the goal adds its worth",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: dash("a")}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":1,"next":4}`,
			wantChanged: true, wantUnits: dash("a", "b"), wantPoints: 1,
		},
		{
			name: "reaching the goal is a tier_up and starts the next tier at zero",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: dash("a", "b", "c", "d"), Points: 3}, event: dashboardCreated("e", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","awarded":["silver"],"final":false,"units":0,"next":10}`,
			wantChanged: true, wantUnits: dash("a", "b", "c", "d", "e"), wantHeld: []string{"bronze", "silver"},
		},
		{
			name: "an item matching several rules scores the highest worth once",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "silver"}}, event: starredDashboard("x", 3),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":2,"next":10}`,
			wantChanged: true, wantUnits: dash("x"), wantPoints: 2,
		},
		{
			name: "an item matching only the lower-worth rule scores that worth",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "silver"}, Units: dash("x"), Points: 2}, event: dashboardCreated("y", 3),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":3,"next":10}`,
			wantChanged: true, wantUnits: dash("x", "y"), wantPoints: 3,
		},
		{
			name: "points past the goal do not carry over",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "silver"}, Units: dash("x"), Points: 9}, event: starredDashboard("y", 3),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["gold"],"final":true,"units":0,"next":null}`,
			wantChanged: true, wantUnits: dash("x", "y"), wantHeld: []string{"bronze", "silver", "gold"},
		},
		{
			name: "an event the current tier's rules reject earns nothing, though a lower tier's rule matches it",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "silver"}, Points: 4}, event: dashboardCreated("z", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":4,"next":10}`,
		},
		{
			name: "an item counted toward a lower tier never counts again",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "silver"}, Units: dash("a")}, event: starredDashboard("a", 3),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":0,"next":10}`,
		},
		{
			name: "a tier counts each of its rules' own units",
			id:   "dash-builder", stored: Progress{}, event: guideCompleted("first-dashboard-cloud", "interactive"),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":4}`,
			wantChanged: true, wantUnits: []string{unitKey("guide", "bundled", "first-dashboard-cloud")},
		},
		{
			name: "an event for a higher tier earns nothing while a lower one is not held",
			id:   "journey", stored: Progress{Units: []string{unitKey("folder", "a")}, Points: 1}, event: contactPointCreated("e1"),
			want: `{"achievementId":"journey","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":1,"next":3}`,
		},
		{
			name: "the first tier of a journey counts its own entity",
			id:   "journey", stored: Progress{Units: []string{unitKey("folder", "a")}, Points: 1}, event: folderCreated("b"),
			want:        `{"achievementId":"journey","decision":"increment","awarded":[],"final":false,"units":2,"next":3}`,
			wantChanged: true, wantUnits: []string{unitKey("folder", "a"), unitKey("folder", "b")}, wantPoints: 2,
		},
		{
			name: "each tier of a journey counts its own entity",
			id:   "journey", stored: Progress{TierIDs: []string{"builder"}, Units: []string{unitKey("folder", "a")}}, event: contactPointCreated("e1"),
			want:        `{"achievementId":"journey","decision":"increment","awarded":[],"final":false,"units":1,"next":2}`,
			wantChanged: true, wantUnits: []string{unitKey("folder", "a"), unitKey(unitOccurrence, "e1")}, wantPoints: 1,
		},
		{
			name: "a tier whose one rule is worth its goal is earned by one event",
			id:   "journey", stored: Progress{TierIDs: []string{"builder", "watcher"}}, event: guideCompleted("observability-journey", "learning-journey"),
			want:        `{"achievementId":"journey","decision":"award","awarded":["capstone"],"final":true,"units":0,"next":null}`,
			wantChanged: true, wantHeld: []string{"builder", "watcher", "capstone"},
		},
		{
			name: "every tier held is complete",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"bronze", "silver"}}, event: guideCompleted("expert", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"complete","awarded":[],"final":true,"units":0,"next":null}`,
		},
		{
			name: "one event earns one tier, though it matches the next tier's rule",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("expert", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a tier the catalog lists below a held one accrues first",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "gold"}, Units: dash("a", "b", "c"), Points: 3}, event: dashboardCreated("f", 1),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["silver"],"final":true,"units":0,"next":null}`,
			wantChanged: true, wantUnits: dash("a", "b", "c", "f"), wantHeld: []string{"bronze", "silver", "gold"},
		},
		{
			name: "a tier id the catalog no longer defines stays held",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"platinum"}}, event: alertCreated("e2"),
			want:        `{"achievementId":"alert-starter","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":2}`,
			wantChanged: true, wantUnits: occurrences("e2"), wantHeld: []string{"bronze", "platinum"},
		},
		{
			name: "newer schema record is untouched",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: dash("a"), Points: 1, SchemaVersion: ProgressSchemaVersion + 1}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","awarded":[],"final":false,"units":1,"next":4}`,
		},
		{
			name: "where that fails is condition_not_met",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 0),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a field the event lacks is condition_not_met",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a field of the wrong type fails its condition",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a", "numPanels": "2"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "missing unit id is invalid_context",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"numPanels": 2.0}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "empty unit id is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("", 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a unit id field the event lacks is invalid_context",
			id:   "well-rounded", stored: Progress{},
			event: Event{ID: "e", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": "bundled"}},
			want:  `{"achievementId":"well-rounded","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":2}`,
		},
		{
			name: "unit id over the cap is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(capCount+"x", 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "unit id of exactly the cap counts",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(capCount, 2),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":4}`,
			wantChanged: true, wantUnits: dash(capCount),
		},
		{
			name: "occurrence counts the event id and a replay adds nothing",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze"}, Units: occurrences("e1")}, event: alertCreated("e1"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":0,"next":2}`,
		},
		{
			name: "occurrence with an empty event id is invalid_context",
			id:   "alert-starter", stored: Progress{}, event: alertCreated(""),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a named resource counts its own unit, so a second guide of one category is a duplicate",
			id:   "well-rounded", stored: Progress{Units: []string{unitKey("guide-category", "interactive")}, Points: 1}, event: guideCompleted("other-guide", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":1,"next":2}`,
		},
		{
			name: "a lowered goal applies on the next new unit",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: dash("a", "b", "c", "d", "e"), Points: 5}, event: dashboardCreated("f", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","awarded":["silver"],"final":false,"units":0,"next":10}`,
			wantChanged: true, wantUnits: dash("a", "b", "c", "d", "e", "f"),
		},
		{
			name: "the ledger is kept sorted and distinct",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: dash("b", "d"), Points: 1}, event: dashboardCreated("c", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":2,"next":4}`,
			wantChanged: true, wantUnits: dash("b", "c", "d"), wantPoints: 2,
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
			if !got.changed {
				return
			}
			if tc.wantUnits != nil && !equalStrings(got.next.Units, tc.wantUnits) {
				t.Errorf("units = %v, want %v", got.next.Units, tc.wantUnits)
			}
			if got.next.Points != tc.wantPoints {
				t.Errorf("points = %d, want %d", got.next.Points, tc.wantPoints)
			}
			if tc.wantHeld != nil && !equalStrings(got.next.TierIDs, tc.wantHeld) {
				t.Errorf("held = %v, want %v", got.next.TierIDs, tc.wantHeld)
			}
			held := heldSet(tc.stored.TierIDs)
			for _, id := range got.decision.Awarded {
				if held[id] || !slices.Contains(got.next.TierIDs, id) {
					t.Errorf("awarded %q was already held or is not persisted as held: %v", id, got.next.TierIDs)
				}
			}
		})
	}
}

func TestEvaluateDoesNotMutateStoredLedger(t *testing.T) {
	catalog := mustCatalog(t)
	stored := Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: dash("a", "c")}
	evaluate(&catalog.Achievements[0], stored, dashboardCreated("b", 1))
	if !equalStrings(stored.Units, dash("a", "c")) {
		t.Errorf("stored ledger mutated: %v", stored.Units)
	}
}

func TestEvaluateLedgerStopsAtTheCap(t *testing.T) {
	catalog := mustCatalog(t)
	d := &catalog.Achievements[2]
	full := make([]string, maxUnits)
	for i := range full {
		full[i] = unitKey(unitOccurrence, fmt.Sprintf("e%03d", i))
	}
	below := Progress{AchievementID: d.ID, TierIDs: []string{"bronze"}, Units: full[:maxUnits-1]}
	if got := evaluate(d, below, alertCreated("e999")); got.decision.Decision != KindIncrement || len(got.next.Units) != maxUnits {
		t.Errorf("the last unit under the cap = %+v units=%d", got.decision, len(got.next.Units))
	}
	at := Progress{AchievementID: d.ID, TierIDs: []string{"bronze"}, Units: full}
	if got := evaluate(d, at, alertCreated("e999")); got.changed || got.decision.Reason != ReasonComplete {
		t.Errorf("a unit past the cap = %+v changed=%v", got.decision, got.changed)
	}
}

func TestEvaluateMixesWorthsTowardOneGoal(t *testing.T) {
	catalog := mustCatalog(t)
	d := &catalog.Achievements[0]
	p := Progress{AchievementID: d.ID, TierIDs: []string{"bronze", "silver"}}
	steps := []struct {
		event  Event
		points int
	}{
		{starredDashboard("a", 3), 2},
		{dashboardCreated("b", 3), 3},
		{dashboardCreated("c", 2), 3},
		{starredDashboard("d", 4), 5},
		{starredDashboard("e", 3), 7},
		{dashboardCreated("f", 5), 8},
		{dashboardCreated("g", 3), 9},
	}
	for i, step := range steps {
		got := evaluate(d, p, step.event)
		if got.changed {
			p = got.next
		}
		if p.Points != step.points {
			t.Fatalf("step %d: points = %d, want %d", i, p.Points, step.points)
		}
	}
	got := evaluate(d, p, dashboardCreated("h", 3))
	if got.decision.Decision != KindAward || !equalStrings(got.decision.Awarded, []string{"gold"}) || got.next.Points != 0 {
		t.Errorf("tenth point = %+v points=%d, want gold", got.decision, got.next.Points)
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
	again, err := loadCatalog(out, registry)
	if err != nil {
		t.Fatalf("re-loading a marshalled catalog: %v", err)
	}
	if decisionJSON(t, catalog.Achievements[0]) != decisionJSON(t, again.Achievements[0]) {
		t.Error("catalog changed across a marshal and load")
	}
}

const guideUnitCatalogJSON = `{"achievements":[
  {"id":"guides","title":"Guides","description":"Finish guides.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]},
     {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]}]}]}`

func guideFinished(source, id string) Event {
	return Event{ID: "evt", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": source, "guideId": id}}
}

func TestEvaluateCompoundUnitIDsCannotCollide(t *testing.T) {
	catalog, err := loadCatalog([]byte(guideUnitCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	d := &catalog.Achievements[0]
	first := evaluate(d, Progress{AchievementID: d.ID}, guideFinished("a:b", "c"))
	second := evaluate(d, first.next, guideFinished("a", "b:c"))
	if second.decision.Decision != KindAward || !equalStrings(second.decision.Awarded, []string{"silver"}) {
		t.Errorf("(a:b, c) and (a, b:c) = %+v, want two distinct guides", second.decision)
	}
	if want := []string{unitKey("guide", "a", "b:c"), unitKey("guide", "a:b", "c")}; !equalStrings(second.next.Units, want) {
		t.Errorf("units = %q, want %q", second.next.Units, want)
	}
}

func TestEvaluateCountsTheRecordersLongestGuideID(t *testing.T) {
	catalog, err := loadCatalog([]byte(guideUnitCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	d := &catalog.Achievements[0]
	source, id := string(repeatByte('s', 256)), string(repeatByte('i', 256))
	got := evaluate(d, Progress{AchievementID: d.ID}, guideFinished(source, id))
	if got.decision.Decision != KindAward || !equalStrings(got.next.Units, []string{unitKey("guide", source, id)}) {
		t.Errorf("a 256-byte source and id = %+v, want one counted guide", got.decision)
	}
}

func TestEvaluateStampsTheProgressSchemaVersion(t *testing.T) {
	catalog := mustCatalog(t)
	d := &catalog.Achievements[0]
	for _, version := range []int{1, ProgressSchemaVersion} {
		stored := Progress{AchievementID: d.ID, TierIDs: []string{"bronze"}, Units: []string{"7:bundled1:a"}, SchemaVersion: version}
		got := evaluate(d, stored, dashboardCreated("a", 1))
		if !got.changed || got.next.SchemaVersion != ProgressSchemaVersion || got.next.Points != 1 || !equalStrings(got.next.TierIDs, []string{"bronze"}) {
			t.Errorf("version %d row = %+v changed=%v, want held tiers kept and the row stamped %d", version, got.next, got.changed, ProgressSchemaVersion)
		}
	}
}
