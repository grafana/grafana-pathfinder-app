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

	cases := []struct {
		name        string
		id          string
		stored      Progress
		event       Event
		want        string
		wantChanged bool
		wantUnits   []string
		wantTierIDs []string
	}{
		{
			name: "first unit awards tier 1",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"t1","final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a")},
		},
		{
			name: "new unit below the next threshold increments",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("a")}}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"t1","to":"t1","final":false,"units":2,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b")},
		},
		{
			name: "reaching a threshold above tier 0 is a tier_up",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d")}}, event: dashboardCreated("e", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":"t1","to":"t2","final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")},
		},
		{
			name: "reaching the last tier is an award, final, with no next",
			id:   "well-rounded", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("interactive"), unitKey("documentation")}}, event: guideCompleted("x", "learning-journey"),
			want:        `{"achievementId":"well-rounded","decision":"award","from":"t1","to":"t2","final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{unitKey("interactive"), unitKey("documentation"), unitKey("learning-journey")},
		},
		{
			name: "the last occurrence tier is a final award",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"t1"}, Units: []string{"e1", "e2"}}, event: alertCreated("e3"),
			want:        `{"achievementId":"alert-starter","decision":"award","from":"t1","to":"t2","final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{"e1", "e2", "e3"},
		},
		{
			name: "unit already in the ledger is a duplicate",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("a")}}, event: dashboardCreated("a", 3),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"duplicate","from":"t1","to":"t1","final":false,"units":1,"next":5}`,
		},
		{
			name: "a final-tier holder keeps counting, so a known unit is a duplicate",
			id:   "well-rounded", stored: Progress{TierIDs: []string{"t1", "t2"}, Units: []string{unitKey("interactive"), unitKey("documentation"), unitKey("learning-journey")}}, event: guideCompleted("x", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","from":"t2","to":"t2","final":true,"units":3,"next":null}`,
		},
		{
			name: "newer schema record is untouched",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("a")}, SchemaVersion: SchemaVersion + 1}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","from":"t1","to":"t1","final":false,"units":1,"next":5}`,
		},
		{
			name: "where that fails is condition_not_met",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 0),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "a field the event lacks is condition_not_met",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "a field of the wrong type fails its condition",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a", "numPanels": "2"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "missing unit id is invalid_context",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"numPanels": 2.0}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "empty unit id is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("", 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "a compound unit id is invalid when one part is missing",
			id:   "well-rounded", stored: Progress{},
			event: Event{ID: "e", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": "bundled"}},
			want:  `{"achievementId":"well-rounded","decision":"ignored","reason":"invalid_context","from":"","to":"","final":false,"units":0,"next":2}`,
		},
		{
			name: "unit id over the cap is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:")+1)), 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "unit id of exactly the cap counts",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:"))), 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"t1","final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey(string(repeatByte('x', maxUnitIDBytes-len("516:"))))},
		},
		{
			name: "a route earns its tier outright",
			id:   "dash-builder", stored: Progress{}, event: guideCompleted("first-dashboard-cloud", "interactive"),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"t1","final":false,"units":0,"next":5}`,
			wantChanged: true, wantUnits: nil,
		},
		{
			name: "a route to a higher tier earns every lower one",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("expert", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":"","to":"t2","final":true,"units":0,"next":null}`,
			wantChanged: true,
		},
		{
			name: "a route to the last milestone tier is a final award",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"t1"}}, event: guideCompleted("advanced", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":"t1","to":"t2","final":true,"units":0,"next":null}`,
			wantChanged: true,
		},
		{
			name: "a route to a tier already held is a duplicate",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"t1"}}, event: guideCompleted("intro", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"duplicate","from":"t1","to":"t1","final":false,"units":0,"next":null}`,
		},
		{
			name: "a route whose where fails is condition_not_met",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("other", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"condition_not_met","from":"","to":"","final":false,"units":0,"next":null}`,
		},
		{
			name: "occurrence counts the event id and a replay adds nothing",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"t1"}, Units: []string{"e1"}}, event: alertCreated("e1"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","from":"t1","to":"t1","final":false,"units":1,"next":3}`,
		},
		{
			name: "occurrence with an empty event id is invalid_context",
			id:   "alert-starter", stored: Progress{}, event: alertCreated(""),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"invalid_context","from":"","to":"","final":false,"units":0,"next":1}`,
		},
		{
			name: "a named resource counts its own unit, so a second guide of one category is a duplicate",
			id:   "well-rounded", stored: Progress{Units: []string{unitKey("interactive")}}, event: guideCompleted("other-guide", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","from":"","to":"","final":false,"units":1,"next":2}`,
		},
		{
			name: "a lowered threshold applies on a duplicate event",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}}, event: dashboardCreated("a", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":"t1","to":"t2","final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")},
		},
		{
			name: "a new unit after the final tier still counts",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"t1", "t2"}, Units: []string{"e1", "e2", "e3"}}, event: alertCreated("e4"),
			want:        `{"achievementId":"alert-starter","decision":"increment","from":"t2","to":"t2","final":true,"units":4,"next":null}`,
			wantChanged: true, wantUnits: []string{"e1", "e2", "e3", "e4"},
		},
		{
			name: "every tier held with the ledger at its ceiling is complete",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"t1", "t2"}, Units: occurrenceUnits(maxOccurrenceAt)}, event: alertCreated("new"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"complete","from":"t2","to":"t2","final":true,"units":50,"next":null}`,
		},
		{
			name: "a tier missing below the highest held one is awarded on the next qualifying event",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t3", "t1"}, Units: dashUnits(25)}, event: dashboardCreated("u00", 1),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"t3","to":"t2","final":true,"units":25,"next":null}`,
			wantChanged: true, wantTierIDs: []string{"t1", "t2", "t3"},
		},
		{
			name: "a tier missing below the highest held one waits for its threshold",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1", "t3"}, Units: dashUnits(3)}, event: dashboardCreated("u03", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"t3","to":"t3","final":false,"units":4,"next":5}`,
			wantChanged: true, wantTierIDs: []string{"t1", "t3"},
		},
		{
			name: "a held tier the catalog does not know leaves the row untouched",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1", "platinum"}, Units: []string{unitKey("a")}}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","from":"t1","to":"t1","final":false,"units":1,"next":5}`,
		},
		{
			name: "the ledger is kept sorted and distinct",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"t1"}, Units: []string{unitKey("b"), unitKey("d")}}, event: dashboardCreated("c", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"t1","to":"t1","final":false,"units":3,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("b"), unitKey("c"), unitKey("d")},
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
			if got.changed && tc.wantTierIDs != nil && !equalStrings(got.next.TierIDs, tc.wantTierIDs) {
				t.Errorf("tier ids = %v, want %v", got.next.TierIDs, tc.wantTierIDs)
			}
			if got.changed && got.decision.To != "" && !slices.Contains(got.next.TierIDs, got.decision.To) {
				t.Errorf("persisted tier ids %v do not hold decision to %q", got.next.TierIDs, got.decision.To)
			}
		})
	}
}

func TestEvaluateDoesNotMutateStoredLedger(t *testing.T) {
	catalog := mustCatalog(t)
	stored := Progress{AchievementID: "dash-builder", TierIDs: []string{"t1"}, Units: []string{unitKey("a"), unitKey("c")}}
	evaluate(&catalog.Achievements[0], stored, dashboardCreated("b", 1))
	if !equalStrings(stored.Units, []string{unitKey("a"), unitKey("c")}) {
		t.Errorf("stored ledger mutated: %v", stored.Units)
	}
}

func TestEvaluateLedgerStopsAtTheCeiling(t *testing.T) {
	catalog := mustCatalog(t)
	alerts := &catalog.Achievements[2]
	stored := Progress{AchievementID: alerts.ID, TierIDs: []string{"t1"}, Units: occurrenceUnits(maxOccurrenceAt)}
	got := evaluate(alerts, stored, alertCreated("past-the-ceiling"))
	if len(got.next.Units) != maxOccurrenceAt || got.decision.To != "t2" || got.decision.Decision != KindAward {
		t.Errorf("ledger grew past its ceiling or missed the final tier: %+v units=%d", got.decision, len(got.next.Units))
	}

	dash := &catalog.Achievements[0]
	full := Progress{AchievementID: dash.ID, TierIDs: []string{"t1", "t2", "t3"}, Units: dashUnits(maxThreshold)}
	if got := evaluate(dash, full, dashboardCreated("past-the-ceiling", 1)); got.changed || got.decision.Reason != ReasonComplete {
		t.Errorf("full resource ledger = %+v changed=%v, want complete", got.decision, got.changed)
	}
}

func TestEvaluateAwardsATierAppendedAboveTheFinalOne(t *testing.T) {
	catalog, err := LoadCatalog([]byte(`{"schemaVersion":1,"achievements":[
	  {"id":"small","title":"Small","description":"Small.",
	   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
	   "tiers":[{"id":"bronze","at":1},{"id":"silver","at":2},{"id":"gold","at":3}]}]}`), mustRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	stored := Progress{AchievementID: "small", TierIDs: []string{"bronze", "silver"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c")}}
	got := evaluate(&catalog.Achievements[0], stored, dashboardCreated("a", 1))
	if got.decision.Decision != KindAward || got.decision.From != "silver" || got.decision.To != "gold" || !equalStrings(got.awarded, []string{"gold"}) {
		t.Errorf("appended gold = %+v awarded=%v, want gold on the next qualifying event", got.decision, got.awarded)
	}
}

func dashUnits(n int) []string {
	units := make([]string, n)
	for i := range units {
		units[i] = unitKey(fmt.Sprintf("u%02d", i))
	}
	slices.Sort(units)
	return units
}

func occurrenceUnits(n int) []string {
	units := make([]string, n)
	for i := range units {
		units[i] = fmt.Sprintf("e%03d", i)
	}
	return units
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
	if again, err := json.Marshal(again); err != nil || string(again) != string(out) {
		t.Error("catalog changed across a marshal and load")
	}
}

const guideUnitCatalogJSON = `{"schemaVersion":1,"achievements":[
  {"id":"guides","title":"Guides","description":"Finish guides.",
   "counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]},
   "tiers":[{"id":"t1","at":1},{"id":"t2","at":2}]}]}`

func guideFinished(source, id string) Event {
	return Event{ID: "evt", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": source, "guideId": id}}
}

func TestEvaluateCompoundUnitIDsCannotCollide(t *testing.T) {
	catalog, err := LoadCatalog([]byte(guideUnitCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	d := &catalog.Achievements[0]
	first := evaluate(d, Progress{AchievementID: d.ID}, guideFinished("a:b", "c"))
	second := evaluate(d, first.next, guideFinished("a", "b:c"))
	if second.decision.Decision != KindAward || second.decision.To != "t2" || second.decision.Units != 2 {
		t.Errorf("(a:b, c) and (a, b:c) = %+v, want two distinct guides", second.decision)
	}
	if want := []string{unitKey("a", "b:c"), unitKey("a:b", "c")}; !equalStrings(second.next.Units, want) {
		t.Errorf("units = %q, want %q", second.next.Units, want)
	}
}

func TestEvaluateCountsTheRecordersLongestGuideID(t *testing.T) {
	catalog, err := LoadCatalog([]byte(guideUnitCatalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	d := &catalog.Achievements[0]
	source, id := string(repeatByte('s', 256)), string(repeatByte('i', 256))
	got := evaluate(d, Progress{AchievementID: d.ID}, guideFinished(source, id))
	if got.decision.Decision != KindAward || got.decision.Units != 1 || !equalStrings(got.next.Units, []string{unitKey(source, id)}) {
		t.Errorf("a 256-byte source and id = %+v, want one counted guide", got.decision)
	}
}

func TestEvaluateKeepsTheStoredSchemaVersion(t *testing.T) {
	catalog := mustCatalog(t)
	stored := Progress{AchievementID: "dash-builder", SchemaVersion: SchemaVersion}
	got := evaluate(&catalog.Achievements[0], stored, dashboardCreated("a", 1))
	if !got.changed || got.next.SchemaVersion != SchemaVersion {
		t.Errorf("changed = %v schemaVersion = %d, want it kept at %d", got.changed, got.next.SchemaVersion, SchemaVersion)
	}
}
