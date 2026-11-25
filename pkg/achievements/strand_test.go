package achievements

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

const strandCatalogJSON = `{"achievements":[
  {"id":"stack","title":"Stack","description":"Dashboards, then alert rules.",
   "tiers":[
     {"id":"bronze","goal":3,"rules":[
        {"entity":"dashboards","action":"created","countBy":"resource"},
        {"entity":"dashboards","action":"created","countBy":"resource","worth":2,"where":[{"field":"starred","op":"eq","value":true}]}]},
     {"id":"silver","goal":2,"rules":[{"entity":"alert-rules","action":"created","countBy":"occurrence"}]}]},
  {"id":"reader","title":"Reader","description":"A guide, then a kind of guide.",
   "tiers":[
     {"id":"bronze","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]},
     {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]}]}
]}`

func evaluatorFor(t *testing.T, catalogJSON string, store Store) *Evaluator {
	t.Helper()
	c, err := loadCatalog([]byte(catalogJSON), mustRegistry(t))
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	return NewEvaluator(c, store, &fakePolicy{}, func() time.Time { return fixedNow })
}

// A tier is stranded when its award row exists but the progress row does not
// hold it: the call that created the award failed to save. Whatever happens to
// that call's retry, the final state must be the one an uninterrupted run reaches.
func TestEvaluateAStrandedTierEndsWhereAnUninterruptedRunDoes(t *testing.T) {
	cases := []struct {
		name    string
		catalog string
		id      string
		seed    Progress
		failed  Event
		then    []Event
		// retryAt is where the failed event is posted again among then; -1 is never.
		retryAt int
	}{
		{
			name: "the retry never arrives and the next tier's evidence follows", catalog: testCatalogJSON, id: "journey",
			seed:   Progress{AchievementID: "journey", Units: []string{unitKey("folder", "f1"), unitKey("folder", "f2")}, Points: 2, SchemaVersion: ProgressSchemaVersion},
			failed: folderCreated("f3"), then: []Event{contactPointCreated("c1"), contactPointCreated("c2")}, retryAt: -1,
		},
		{
			name: "the retry arrives after the next tier's evidence", catalog: testCatalogJSON, id: "journey",
			seed:   Progress{AchievementID: "journey", Units: []string{unitKey("folder", "f1"), unitKey("folder", "f2")}, Points: 2, SchemaVersion: ProgressSchemaVersion},
			failed: folderCreated("f3"), then: []Event{contactPointCreated("c1"), contactPointCreated("c2")}, retryAt: 1,
		},
		{
			name: "the same unit is counted at a lower worth, so the retry is a duplicate", catalog: strandCatalogJSON, id: "stack",
			seed:   Progress{AchievementID: "stack", Units: dash("a"), Points: 1, SchemaVersion: ProgressSchemaVersion},
			failed: starredDashboard("b", 1), then: []Event{dashboardCreated("b", 1), alertCreated("e1"), alertCreated("e2")}, retryAt: 1,
		},
		{
			name: "the retry is the next event and the next tier counts its pair by another unit", catalog: strandCatalogJSON, id: "reader",
			failed: guideCompleted("x", "interactive"), then: []Event{}, retryAt: 0,
		},
		{
			name: "another unit for the stranded tier arrives first", catalog: strandCatalogJSON, id: "stack",
			seed:   Progress{AchievementID: "stack", Units: dash("a"), Points: 1, SchemaVersion: ProgressSchemaVersion},
			failed: starredDashboard("b", 1), then: []Event{dashboardCreated("c", 1), alertCreated("e1"), alertCreated("e2")}, retryAt: 3,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			want, wantAwards, wantReports := strandRun(t, c.catalog, c.id, c.seed, append([]Event{c.failed}, c.then...), -1)

			interrupted := slices.Clone(c.then)
			if c.retryAt >= 0 {
				interrupted = slices.Insert(interrupted, c.retryAt, c.failed)
			}
			got, gotAwards, gotReports := strandRun(t, c.catalog, c.id, c.seed, append([]Event{c.failed}, interrupted...), 0)

			if !equalStrings(got.TierIDs, want.TierIDs) || !equalStrings(got.Units, want.Units) || got.Points != want.Points {
				t.Errorf("row\n got held=%v units=%v points=%d\nwant held=%v units=%v points=%d", got.TierIDs, got.Units, got.Points, want.TierIDs, want.Units, want.Points)
			}
			if !equalStrings(gotAwards, wantAwards) {
				t.Errorf("award rows = %v, want %v", gotAwards, wantAwards)
			}
			if !equalStrings(gotReports, wantReports) {
				t.Errorf("tiers reported awarded = %v, want each held tier once: %v", gotReports, wantReports)
			}
		})
	}
}

// strandRun posts events in order and fails the save of the one at failAt
// (-1 for none). It returns the final row, the award rows and every tier
// a decision reported awarded, each sorted.
func strandRun(t *testing.T, catalogJSON, id string, seed Progress, events []Event, failAt int) (Progress, []string, []string) {
	t.Helper()
	store := newFakeStore()
	if seed.AchievementID != "" {
		store.seed(seed)
	}
	ev := evaluatorFor(t, catalogJSON, store)
	var reported []string
	for i, event := range events {
		if i == failAt {
			store.saveErr = errors.New("down")
		}
		d := decisionFor(t, mustEvaluate(t, ev, event), id)
		if i == failAt {
			store.saveErr = nil
			if d.Reason != ReasonStoreUnavailable || len(store.awards) == 0 {
				t.Fatalf("setup: the failed call = %+v with %d award rows, want store_unavailable after an award", d, len(store.awards))
			}
		}
		reported = append(reported, d.Awarded...)
	}
	var awards []string
	for key := range store.awards {
		awards = append(awards, key)
	}
	slices.Sort(awards)
	slices.Sort(reported)
	return store.progress[id], awards, reported
}

func TestEvaluateRecordsTheEarningUnitOnTheAward(t *testing.T) {
	store := newFakeStore()
	mustEvaluate(t, newTestEvaluator(t, store, &fakePolicy{}), dashboardCreated("a", 2))
	if got := store.awards["dash-builder/bronze"].Unit; got != dash("a")[0] {
		t.Errorf("award unit = %q, want %q", got, dash("a")[0])
	}
}

// Without the unit that earned it, holding the tier could count that unit
// again toward the next one, so the row waits for the tier's goal as before.
func TestEvaluateAnAwardRowWithoutItsUnitIsNotHeldBeforeScoring(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "well-rounded", Units: []string{unitKey("guide-category", "interactive")}, Points: 1, SchemaVersion: ProgressSchemaVersion})
	store.awards["well-rounded/bronze"] = Award{AchievementID: "well-rounded", TierID: "bronze"}
	ev := newTestEvaluator(t, store, &fakePolicy{})

	if d := decisionFor(t, mustEvaluate(t, ev, guideCompleted("again", "interactive")), "well-rounded"); d.Reason != ReasonDuplicate || len(d.Awarded) != 0 {
		t.Errorf("duplicate = %+v, want nothing held", d)
	}
	if d := decisionFor(t, mustEvaluate(t, ev, guideCompleted("docs", "documentation")), "well-rounded"); !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Errorf("the earning unit = %+v, want bronze", d)
	}
	if row := store.progress["well-rounded"]; !equalStrings(row.TierIDs, []string{"bronze"}) || row.Points != 0 || len(store.awards) != 1 {
		t.Errorf("row = %+v awards = %d, want silver not reached", row, len(store.awards))
	}
}

func TestEvaluateAFailedAwardReadSpendsNothing(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "journey", Units: []string{unitKey("folder", "f1")}, Points: 1, SchemaVersion: ProgressSchemaVersion})
	ev := evaluatorFor(t, testCatalogJSON, &awardReadFails{store})
	decisions := mustEvaluate(t, ev, folderCreated("f2"))
	if d := decisionFor(t, decisions, "journey"); d.Reason != ReasonStoreUnavailable || !Retry(decisions) {
		t.Errorf("decision = %+v, want a transient store_unavailable", d)
	}
	if store.saves != 0 || store.awardCalls != 0 {
		t.Errorf("saves = %d award creates = %d, want none", store.saves, store.awardCalls)
	}
}

type awardReadFails struct{ *fakeStore }

func (s *awardReadFails) LoadAward(context.Context, Person, string, string) (Award, bool, error) {
	return Award{}, false, errors.New("down")
}

func TestEvaluateReadsNoAwardOnceEveryTierIsHeld(t *testing.T) {
	store := &awardReads{fakeStore: newFakeStore()}
	store.seed(Progress{AchievementID: "guide-routes", TierIDs: []string{"bronze", "silver"}, SchemaVersion: ProgressSchemaVersion})
	if d := decisionFor(t, mustEvaluate(t, evaluatorFor(t, testCatalogJSON, store), guideCompleted("intro", "interactive")), "guide-routes"); d.Reason != ReasonComplete {
		t.Fatalf("decision = %+v", d)
	}
	if slices.Contains(store.achievements, "guide-routes") {
		t.Errorf("award reads for %v, want none for guide-routes", store.achievements)
	}
}

type awardReads struct {
	*fakeStore
	achievements []string
}

func (s *awardReads) LoadAward(ctx context.Context, p Person, achievementID, tierID string) (Award, bool, error) {
	s.achievements = append(s.achievements, achievementID)
	return s.fakeStore.LoadAward(ctx, p, achievementID, tierID)
}
