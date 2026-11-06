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
		wantHeld    []string
	}{
		{
			name: "first unit awards bronze",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 2),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a")},
		},
		{
			name: "new unit below the next threshold increments",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":2,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b")},
		},
		{
			name: "reaching silver's threshold is a tier_up",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d")}}, event: dashboardCreated("e", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","awarded":["silver"],"final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")},
		},
		{
			name: "reaching the last tier is an award, final, with no next",
			id:   "well-rounded", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("documentation"), unitKey("interactive")}}, event: guideCompleted("x", "learning-journey"),
			want:        `{"achievementId":"well-rounded","decision":"award","awarded":["silver"],"final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{unitKey("documentation"), unitKey("interactive"), unitKey("learning-journey")},
		},
		{
			name: "the last occurrence tier is a final award",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{"e1", "e2"}}, event: alertCreated("e3"),
			want:        `{"achievementId":"alert-starter","decision":"award","awarded":["silver"],"final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{"e1", "e2", "e3"},
		},
		{
			name: "unit already in the ledger is a duplicate",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}}, event: dashboardCreated("a", 3),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":1,"next":5}`,
		},
		{
			name: "counting continues past the final tier",
			id:   "well-rounded", stored: Progress{TierIDs: []string{"bronze", "silver"}, Units: []string{unitKey("documentation"), unitKey("interactive")}}, event: guideCompleted("x", "learning-journey"),
			want:        `{"achievementId":"well-rounded","decision":"increment","awarded":[],"final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{unitKey("documentation"), unitKey("interactive"), unitKey("learning-journey")},
		},
		{
			name: "a held milestone is complete",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"bronze", "silver"}}, event: guideCompleted("expert", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"complete","awarded":[],"final":true,"units":0,"next":null}`,
		},
		{
			name: "a tier inserted below a held one is awarded on the next qualifying event",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "gold"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}}, event: dashboardCreated("f", 1),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["silver"],"final":true,"units":6,"next":null}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e"), unitKey("f")},
		},
		{
			name: "a tier id the catalog no longer defines stays held",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"platinum"}, Units: []string{"e1"}}, event: alertCreated("e2"),
			want:        `{"achievementId":"alert-starter","decision":"award","awarded":["bronze"],"final":false,"units":2,"next":3}`,
			wantChanged: true, wantUnits: []string{"e1", "e2"}, wantHeld: []string{"bronze", "platinum"},
		},
		{
			name: "newer schema record is untouched",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}, SchemaVersion: SchemaVersion + 1}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","awarded":[],"final":false,"units":1,"next":5}`,
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
			name: "a compound unit id is invalid when one part is missing",
			id:   "well-rounded", stored: Progress{},
			event: Event{ID: "e", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": "bundled"}},
			want:  `{"achievementId":"well-rounded","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":2}`,
		},
		{
			name: "unit id over the cap is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:")+1)), 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "unit id of exactly the cap counts",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:"))), 2),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey(string(repeatByte('x', maxUnitIDBytes-len("516:"))))},
		},
		{
			name: "a route earns its tier outright",
			id:   "dash-builder", stored: Progress{}, event: guideCompleted("first-dashboard-cloud", "interactive"),
			want:        `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":5}`,
			wantChanged: true, wantUnits: nil,
		},
		{
			name: "a route to a higher tier earns every lower one",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("expert", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","awarded":["bronze","silver"],"final":true,"units":0,"next":null}`,
			wantChanged: true,
		},
		{
			name: "a route to the last milestone tier is a final award",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"bronze"}}, event: guideCompleted("advanced", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","awarded":["silver"],"final":true,"units":0,"next":null}`,
			wantChanged: true,
		},
		{
			name: "a route to a tier already held is a duplicate",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"bronze"}}, event: guideCompleted("intro", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":0,"next":null}`,
		},
		{
			name: "a route whose where fails is condition_not_met",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("other", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"condition_not_met","awarded":[],"final":false,"units":0,"next":null}`,
		},
		{
			name: "occurrence counts the event id and a replay adds nothing",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{"e1"}}, event: alertCreated("e1"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":1,"next":3}`,
		},
		{
			name: "occurrence with an empty event id is invalid_context",
			id:   "alert-starter", stored: Progress{}, event: alertCreated(""),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"invalid_context","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a named resource counts its own unit, so a second guide of one category is a duplicate",
			id:   "well-rounded", stored: Progress{Units: []string{unitKey("interactive")}}, event: guideCompleted("other-guide", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","awarded":[],"final":false,"units":1,"next":2}`,
		},
		{
			name: "a lowered threshold applies on a duplicate event",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}}, event: dashboardCreated("a", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","awarded":["silver"],"final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")},
		},
		{
			name: "the ledger is kept sorted and distinct",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("b"), unitKey("d")}}, event: dashboardCreated("c", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","awarded":[],"final":false,"units":3,"next":5}`,
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
	stored := Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: []string{unitKey("a"), unitKey("c")}}
	evaluate(&catalog.Achievements[0], stored, dashboardCreated("b", 1))
	if !equalStrings(stored.Units, []string{unitKey("a"), unitKey("c")}) {
		t.Errorf("stored ledger mutated: %v", stored.Units)
	}
}

func TestEvaluateLedgerStopsAtTheCeiling(t *testing.T) {
	registry := mustRegistry(t)
	catalog, err := LoadCatalog([]byte(`{"schemaVersion":1,"achievements":[
	  {"id":"small","title":"Small","description":"Small.",
	   "counter":{"unit":"occurrence","evidence":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]},
	   "tiers":[{"id":"bronze","at":1},{"id":"silver","at":2}]}]}`), registry)
	if err != nil {
		t.Fatal(err)
	}
	d := &catalog.Achievements[0]
	full := make([]string, maxOccurrenceAt)
	for i := range full {
		full[i] = fmt.Sprintf("e%03d", i)
	}
	below := Progress{AchievementID: d.ID, TierIDs: []string{"bronze", "silver"}, Units: full[:maxOccurrenceAt-1]}
	got := evaluate(d, below, alertCreated(full[maxOccurrenceAt-1]))
	if got.decision.Decision != KindIncrement || got.decision.Units != maxOccurrenceAt {
		t.Errorf("last unit under the ceiling = %+v", got.decision)
	}
	at := Progress{AchievementID: d.ID, TierIDs: []string{"bronze", "silver"}, Units: full}
	if got := evaluate(d, at, alertCreated("e999")); got.changed || got.decision.Reason != ReasonComplete {
		t.Errorf("a unit past the ceiling = %+v changed=%v", got.decision, got.changed)
	}
	unheld := Progress{AchievementID: d.ID, Units: full}
	got = evaluate(d, unheld, alertCreated("e999"))
	if !equalStrings(got.next.Units, full) || !equalStrings(got.decision.Awarded, []string{"bronze", "silver"}) {
		t.Errorf("a full ledger still awards what it meets: %+v units=%d", got.decision, len(got.next.Units))
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
	if decisionJSON(t, catalog.Achievements[0]) != decisionJSON(t, again.Achievements[0]) {
		t.Error("catalog changed across a marshal and load")
	}
}

const guideUnitCatalogJSON = `{"schemaVersion":1,"achievements":[
  {"id":"guides","title":"Guides","description":"Finish guides.",
   "counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]},
   "tiers":[{"id":"bronze","at":1},{"id":"silver","at":2}]}]}`

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
	if second.decision.Decision != KindAward || !equalStrings(second.decision.Awarded, []string{"silver"}) || second.decision.Units != 2 {
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
