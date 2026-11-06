package achievements

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestEvaluateGolden(t *testing.T) {
	catalog := mustCatalog(t)
	defs := map[string]*Definition{}
	for i := range catalog.Achievements {
		defs[catalog.Achievements[i].ID] = &catalog.Achievements[i]
	}

	dashUnits := func(n int) []string {
		units := make([]string, n)
		for i := range units {
			units[i] = unitKey(fmt.Sprintf("d%03d", i))
		}
		return units
	}
	alertUnits := func(n int) []string {
		units := make([]string, n)
		for i := range units {
			units[i] = fmt.Sprintf("e%03d", i)
		}
		return units
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
			name: "first unit awards the first tier",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"bronze","awarded":["bronze"],"final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a")}, wantTierIDs: []string{"bronze"},
		},
		{
			name: "new unit below the next threshold increments",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"bronze","to":"bronze","awarded":[],"final":false,"units":2,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b")}, wantTierIDs: []string{"bronze"},
		},
		{
			name: "reaching a threshold above the first tier is a tier_up",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d")}}, event: dashboardCreated("e", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":"bronze","to":"silver","awarded":["silver"],"final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}, wantTierIDs: []string{"bronze", "silver"},
		},
		{
			name: "reaching the last tier is an award, final, with no next",
			id:   "well-rounded", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("documentation"), unitKey("interactive")}}, event: guideCompleted("x", "learning-journey"),
			want:        `{"achievementId":"well-rounded","decision":"award","from":"bronze","to":"silver","awarded":["silver"],"final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{unitKey("documentation"), unitKey("interactive"), unitKey("learning-journey")}, wantTierIDs: []string{"bronze", "silver"},
		},
		{
			name: "the last occurrence tier is a final award",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{"e1", "e2"}}, event: alertCreated("e3"),
			want:        `{"achievementId":"alert-starter","decision":"award","from":"bronze","to":"silver","awarded":["silver"],"final":true,"units":3,"next":null}`,
			wantChanged: true, wantUnits: []string{"e1", "e2", "e3"}, wantTierIDs: []string{"bronze", "silver"},
		},
		{
			name: "unit already in the ledger is a duplicate",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}}, event: dashboardCreated("a", 3),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"duplicate","from":"bronze","to":"bronze","awarded":[],"final":false,"units":1,"next":5}`,
		},
		{
			name: "every tier held keeps counting below the ceiling",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "gold", "silver"}, Units: dashUnits(25)}, event: dashboardCreated("new", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"gold","to":"gold","awarded":[],"final":true,"units":26,"next":null}`,
			wantChanged: true, wantTierIDs: []string{"bronze", "gold", "silver"},
		},
		{
			name: "every tier held with a ledger at the ceiling is complete",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "gold", "silver"}, Units: dashUnits(maxThreshold)}, event: dashboardCreated("new", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"complete","from":"gold","to":"gold","awarded":[],"final":true,"units":200,"next":null}`,
		},
		{
			name: "an occurrence counter's ceiling is 50",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze", "silver"}, Units: alertUnits(maxOccurrenceAt)}, event: alertCreated("e-new"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"complete","from":"silver","to":"silver","awarded":[],"final":true,"units":50,"next":null}`,
		},
		{
			name: "a tier below the highest held is awarded once its threshold is met",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"silver"}, Units: dashUnits(5)}, event: dashboardCreated("new", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":"silver","to":"silver","awarded":["bronze"],"final":false,"units":6,"next":25}`,
			wantChanged: true, wantTierIDs: []string{"bronze", "silver"},
		},
		{
			name: "a tier below the highest held is awarded on a duplicate event too",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"gold", "silver"}, Units: dashUnits(25)}, event: dashboardCreated("d000", 1),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"gold","to":"gold","awarded":["bronze"],"final":true,"units":25,"next":null}`,
			wantChanged: true, wantTierIDs: []string{"bronze", "gold", "silver"},
		},
		{
			name: "a held tier id the catalog does not know is kept",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze", "platinum"}, Units: []string{unitKey("a")}}, event: dashboardCreated("b", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"bronze","to":"bronze","awarded":[],"final":false,"units":2,"next":5}`,
			wantChanged: true, wantTierIDs: []string{"bronze", "platinum"},
		},
		{
			name: "newer schema record is untouched",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a")}, SchemaVersion: SchemaVersion + 1}, event: dashboardCreated("b", 1),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"record_newer","from":"bronze","to":"bronze","awarded":[],"final":false,"units":1,"next":5}`,
		},
		{
			name: "where that fails is condition_not_met",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("a", 0),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a field the event lacks is condition_not_met",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a field of the wrong type fails its condition",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"resourceId": "a", "numPanels": "2"}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"condition_not_met","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "missing unit id is invalid_context",
			id:   "dash-builder", stored: Progress{},
			event: Event{ID: "e", Entity: "dashboards", Action: "created", Context: map[string]any{"numPanels": 2.0}},
			want:  `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "empty unit id is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated("", 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a compound unit id is invalid when one part is missing",
			id:   "well-rounded", stored: Progress{},
			event: Event{ID: "e", Entity: "guides", Action: "completed", Context: map[string]any{"guideSource": "bundled"}},
			want:  `{"achievementId":"well-rounded","decision":"ignored","reason":"invalid_context","from":"","to":"","awarded":[],"final":false,"units":0,"next":2}`,
		},
		{
			name: "unit id over the cap is invalid_context",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:")+1)), 2),
			want: `{"achievementId":"dash-builder","decision":"ignored","reason":"invalid_context","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "unit id of exactly the cap counts",
			id:   "dash-builder", stored: Progress{}, event: dashboardCreated(string(repeatByte('x', maxUnitIDBytes-len("516:"))), 2),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"bronze","awarded":["bronze"],"final":false,"units":1,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey(string(repeatByte('x', maxUnitIDBytes-len("516:"))))}, wantTierIDs: []string{"bronze"},
		},
		{
			name: "a route earns its tier outright",
			id:   "dash-builder", stored: Progress{}, event: guideCompleted("first-dashboard-cloud", "interactive"),
			want:        `{"achievementId":"dash-builder","decision":"award","from":"","to":"bronze","awarded":["bronze"],"final":false,"units":0,"next":5}`,
			wantChanged: true, wantTierIDs: []string{"bronze"},
		},
		{
			name: "a route to a higher tier earns every lower one",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("expert", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":"","to":"advanced","awarded":["intro","advanced"],"final":true,"units":0,"next":null}`,
			wantChanged: true, wantTierIDs: []string{"advanced", "intro"},
		},
		{
			name: "a route to the last milestone tier is a final award",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"intro"}}, event: guideCompleted("advanced", "interactive"),
			want:        `{"achievementId":"guide-routes","decision":"award","from":"intro","to":"advanced","awarded":["advanced"],"final":true,"units":0,"next":null}`,
			wantChanged: true, wantTierIDs: []string{"advanced", "intro"},
		},
		{
			name: "a route to a tier already held is a duplicate",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"intro"}}, event: guideCompleted("intro", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"duplicate","from":"intro","to":"intro","awarded":[],"final":false,"units":0,"next":null}`,
		},
		{
			name: "a milestone with every tier held is complete",
			id:   "guide-routes", stored: Progress{TierIDs: []string{"advanced", "intro"}}, event: guideCompleted("intro", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"complete","from":"advanced","to":"advanced","awarded":[],"final":true,"units":0,"next":null}`,
		},
		{
			name: "a route whose where fails is condition_not_met",
			id:   "guide-routes", stored: Progress{}, event: guideCompleted("other", "interactive"),
			want: `{"achievementId":"guide-routes","decision":"ignored","reason":"condition_not_met","from":"","to":"","awarded":[],"final":false,"units":0,"next":null}`,
		},
		{
			name: "occurrence counts the event id and a replay adds nothing",
			id:   "alert-starter", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{"e1"}}, event: alertCreated("e1"),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"duplicate","from":"bronze","to":"bronze","awarded":[],"final":false,"units":1,"next":3}`,
		},
		{
			name: "occurrence with an empty event id is invalid_context",
			id:   "alert-starter", stored: Progress{}, event: alertCreated(""),
			want: `{"achievementId":"alert-starter","decision":"ignored","reason":"invalid_context","from":"","to":"","awarded":[],"final":false,"units":0,"next":1}`,
		},
		{
			name: "a named resource counts its own unit, so a second guide of one category is a duplicate",
			id:   "well-rounded", stored: Progress{Units: []string{unitKey("interactive")}}, event: guideCompleted("other-guide", "interactive"),
			want: `{"achievementId":"well-rounded","decision":"ignored","reason":"duplicate","from":"","to":"","awarded":[],"final":false,"units":1,"next":2}`,
		},
		{
			name: "a lowered threshold applies on a duplicate event",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}}, event: dashboardCreated("a", 1),
			want:        `{"achievementId":"dash-builder","decision":"tier_up","from":"bronze","to":"silver","awarded":["silver"],"final":false,"units":5,"next":25}`,
			wantChanged: true, wantUnits: []string{unitKey("a"), unitKey("b"), unitKey("c"), unitKey("d"), unitKey("e")}, wantTierIDs: []string{"bronze", "silver"},
		},
		{
			name: "the ledger is kept sorted and distinct",
			id:   "dash-builder", stored: Progress{TierIDs: []string{"bronze"}, Units: []string{unitKey("b"), unitKey("d")}}, event: dashboardCreated("c", 1),
			want:        `{"achievementId":"dash-builder","decision":"increment","from":"bronze","to":"bronze","awarded":[],"final":false,"units":3,"next":5}`,
			wantChanged: true, wantUnits: []string{unitKey("b"), unitKey("c"), unitKey("d")}, wantTierIDs: []string{"bronze"},
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
			if got.changed && !equalStrings(got.next.TierIDs, tc.wantTierIDs) {
				t.Errorf("persisted tier ids = %v, want %v", got.next.TierIDs, tc.wantTierIDs)
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

func TestEvaluateAppendedTierLandsForCountsThatAlreadyMeetIt(t *testing.T) {
	registry := mustRegistry(t)
	load := func(tiers string) *Definition {
		t.Helper()
		c, err := LoadCatalog([]byte(`{"schemaVersion":1,"achievements":[
		  {"id":"small","title":"Small","description":"Small.",
		   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
		   "tiers":`+tiers+`}]}`), registry)
		if err != nil {
			t.Fatal(err)
		}
		return &c.Achievements[0]
	}
	before := load(`[{"id":"bronze","at":1},{"id":"silver","at":2}]`)
	stored := Progress{AchievementID: "small"}
	for _, uid := range []string{"a", "b", "c"} {
		stored = evaluate(before, stored, dashboardCreated(uid, 1)).next
	}
	if len(stored.Units) != 3 {
		t.Fatalf("units = %v, want counting to continue past the final tier", stored.Units)
	}

	after := load(`[{"id":"bronze","at":1},{"id":"silver","at":2},{"id":"gold","at":3}]`)
	got := evaluate(after, stored, dashboardCreated("a", 1))
	if got.decision.Decision != KindAward || !equalStrings(got.decision.Awarded, []string{"gold"}) || !got.decision.Final {
		t.Errorf("appended gold on the next event = %+v", got.decision)
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
	again2, err := json.Marshal(again)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != string(again2) {
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
	if second.decision.Decision != KindAward || second.decision.To != "silver" || second.decision.Units != 2 {
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
