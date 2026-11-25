package achievements

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
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
     {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]}]},
  {"id":"shelf","title":"Shelf","description":"Guides, then kinds of guide.",
   "tiers":[
     {"id":"bronze","goal":2,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]},
     {"id":"silver","goal":2,"rules":[{"entity":"guides","action":"completed","countBy":{"resource":"guide-category"}}]}]}
]}`

func withID(ev Event, id string) Event {
	ev.ID = id
	return ev
}

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
			failed: starredDashboard("b", 1), then: []Event{withID(dashboardCreated("b", 1), "evt-b-plain"), alertCreated("e1"), alertCreated("e2")}, retryAt: 1,
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
		{
			name: "another event holds the tier first and the next tier counts the retry's pair by another unit", catalog: strandCatalogJSON, id: "shelf",
			seed:   Progress{AchievementID: "shelf", Units: []string{unitKey("guide", "bundled", "w")}, Points: 1, SchemaVersion: ProgressSchemaVersion},
			failed: guideCompleted("x", "interactive"), then: []Event{guideCompleted("y", "documentation")}, retryAt: 1,
		},
		{
			name: "a distinct event for the stranded tier's unit counts toward the next tier", catalog: strandCatalogJSON, id: "reader",
			failed: guideCompleted("x", "interactive"), then: []Event{withID(guideCompleted("x", "interactive"), "evt-x-again")}, retryAt: 1,
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

			if !equalStrings(got.TierIDs, want.TierIDs) || !equalStrings(got.Units, want.Units) || !equalStrings(got.EventIDs, want.EventIDs) || got.Points != want.Points {
				t.Errorf("row\n got held=%v units=%v events=%v points=%d\nwant held=%v units=%v events=%v points=%d",
					got.TierIDs, got.Units, got.EventIDs, got.Points, want.TierIDs, want.Units, want.EventIDs, want.Points)
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

func TestEvaluateRecordsTheEarningUnitAndEventOnTheAward(t *testing.T) {
	store := newFakeStore()
	mustEvaluate(t, newTestEvaluator(t, store, &fakePolicy{}), dashboardCreated("a", 2))
	if got := store.awards["dash-builder/bronze"]; got.Unit != dash("a")[0] || got.EventID != "evt-a" {
		t.Errorf("award unit = %q event = %q, want %q and evt-a", got.Unit, got.EventID, dash("a")[0])
	}
	if got := store.progress["dash-builder"].EventIDs; !equalStrings(got, []string{"evt-a"}) {
		t.Errorf("event ids = %v, want the counted event", got)
	}
}

// Without the unit and event that earned it, holding the tier could count
// either again, so the row waits for the tier's goal as before.
func TestEvaluateAnAwardRowWithoutItsUnitAndEventIsNotHeldBeforeScoring(t *testing.T) {
	for name, award := range map[string]Award{
		"neither":   {AchievementID: "well-rounded", TierID: "bronze"},
		"unit only": {AchievementID: "well-rounded", TierID: "bronze", Unit: unitKey("guide-category", "documentation")},
	} {
		t.Run(name, func(t *testing.T) {
			store := newFakeStore()
			store.seed(Progress{AchievementID: "well-rounded", Units: []string{unitKey("guide-category", "interactive")}, Points: 1, SchemaVersion: ProgressSchemaVersion})
			store.awards["well-rounded/bronze"] = award
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
		})
	}
}

// The heal holds bronze for x's award before x's save, so x's re-run is a duplicate.
func TestEvaluateAHealDuringTheEarningEventsSaveLeavesItsReRunADuplicate(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "shelf", Units: []string{unitKey("guide", "bundled", "w")}, Points: 1, SchemaVersion: ProgressSchemaVersion})
	replica := evaluatorFor(t, strandCatalogJSON, store)
	var healer Decision
	store.beforeSave = func(s *fakeStore, _ int) {
		if _, awarded := s.awards["shelf/bronze"]; awarded {
			s.beforeSave = nil
			healer = decisionFor(t, mustEvaluate(t, replica, guideCompleted("y", "documentation")), "shelf")
		}
	}
	earning := decisionFor(t, mustEvaluate(t, evaluatorFor(t, strandCatalogJSON, store), guideCompleted("x", "interactive")), "shelf")
	if !equalStrings(healer.Awarded, []string{"bronze"}) || healer.Units != 1 || earning.Reason != ReasonDuplicate || len(earning.Awarded) != 0 {
		t.Errorf("healer = %+v earning = %+v, want bronze reported once and y's point toward silver", healer, earning)
	}
	row := store.progress["shelf"]
	_, silver := store.awards["shelf/silver"]
	if !equalStrings(row.TierIDs, []string{"bronze"}) || row.Points != 1 || !equalStrings(row.EventIDs, []string{"evt-x", "evt-y"}) || silver {
		t.Errorf("row = %+v silver awarded = %v, want bronze and 1 point toward silver, as either serial order ends", row, silver)
	}
}

// Each tier may count guides by another unit, so only the event id tells that a
// posted event has counted already.
func TestEvaluateARepostedEventCountsNothingMoreWhateverUnitTheNextTierCounts(t *testing.T) {
	store := newFakeStore()
	ev := evaluatorFor(t, strandCatalogJSON, store)
	x, y := guideCompleted("x", "interactive"), guideCompleted("y", "documentation")
	mustEvaluate(t, ev, x)
	if d := decisionFor(t, mustEvaluate(t, ev, y), "shelf"); !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Fatalf("setup: y = %+v, want bronze", d)
	}
	before := store.progress["shelf"]
	for _, again := range []Event{x, y, x} {
		if d := decisionFor(t, mustEvaluate(t, ev, again), "shelf"); d.Reason != ReasonDuplicate || d.Units != 0 {
			t.Errorf("%s posted again = %+v, want a duplicate with nothing toward silver", again.ID, d)
		}
	}
	if after := store.progress["shelf"]; after.Version != before.Version {
		t.Errorf("row %+v -> %+v, want nothing written", before, after)
	}
	if d := decisionFor(t, mustEvaluate(t, ev, withID(x, "evt-x-again")), "shelf"); d.Decision != KindIncrement || d.Units != 1 {
		t.Errorf("x completed again = %+v, want its kind of guide counted toward silver", d)
	}
}

// Rows stored before event ids were recorded still find a re-post by its unit.
func TestEvaluateARowWithoutEventIDsKeepsCounting(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "shelf", Units: []string{unitKey("guide", "bundled", "x")}, Points: 1, SchemaVersion: ProgressSchemaVersion})
	ev := evaluatorFor(t, strandCatalogJSON, store)
	before := store.progress["shelf"]
	if d := decisionFor(t, mustEvaluate(t, ev, guideCompleted("x", "interactive")), "shelf"); d.Reason != ReasonDuplicate || store.progress["shelf"].Version != before.Version {
		t.Errorf("x posted again = %+v, want a duplicate and nothing written", d)
	}
	if d := decisionFor(t, mustEvaluate(t, ev, guideCompleted("y", "documentation")), "shelf"); !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Errorf("y = %+v, want bronze", d)
	}
	if row := store.progress["shelf"]; !equalStrings(row.EventIDs, []string{"evt-y"}) || len(row.Units) != 2 {
		t.Errorf("row = %+v, want y's id recorded beside its unit", row)
	}
}

func TestEvaluateEventIDsStayWithinTheirBound(t *testing.T) {
	d := &mustCatalog(t).Achievements[2]
	full := make([]string, maxEventIDs)
	for i := range full {
		full[i] = fmt.Sprintf("evt-%03d", i)
	}
	got := evaluate(d, Progress{AchievementID: d.ID, TierIDs: []string{"bronze"}, EventIDs: full}, alertCreated("e999"))
	if got.decision.Decision != KindIncrement || len(got.next.Units) != 1 || len(got.next.EventIDs) != maxEventIDs {
		t.Errorf("a count at the bound = %+v units=%d events=%d, want the unit counted and no id past %d", got.decision, len(got.next.Units), len(got.next.EventIDs), maxEventIDs)
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

// overlapStore runs a hook the first time the named request reaches a store
// call, so a test can interleave requests the way concurrent replicas do.
type overlapStore struct {
	*fakeStore
	running     []string
	afterLoad   map[string]func()
	beforeAward map[string]func()
	beforeSave  map[string]func(row Progress) (Progress, error, bool)
}

func newOverlapStore() *overlapStore {
	return &overlapStore{fakeStore: newFakeStore(), afterLoad: map[string]func(){}, beforeAward: map[string]func(){},
		beforeSave: map[string]func(Progress) (Progress, error, bool){}}
}

func (s *overlapStore) top() string { return s.running[len(s.running)-1] }

func (s *overlapStore) LoadProgress(ctx context.Context, p Person, ids []string) (map[string]Progress, error) {
	rows, err := s.fakeStore.LoadProgress(ctx, p, ids)
	if hook := s.afterLoad[s.top()]; hook != nil {
		delete(s.afterLoad, s.top())
		hook()
	}
	return rows, err
}

func (s *overlapStore) CreateAward(ctx context.Context, p Person, a Award) error {
	if hook := s.beforeAward[s.top()]; hook != nil {
		delete(s.beforeAward, s.top())
		hook()
	}
	return s.fakeStore.CreateAward(ctx, p, a)
}

func (s *overlapStore) SaveProgress(ctx context.Context, p Person, row Progress) (Progress, error) {
	if hook := s.beforeSave[s.top()]; hook != nil {
		delete(s.beforeSave, s.top())
		if saved, err, handled := hook(row); handled {
			return saved, err
		}
	}
	return s.fakeStore.SaveProgress(ctx, p, row)
}

func (s *overlapStore) post(t *testing.T, ev *Evaluator, request string, event Event) Decision {
	s.running = append(s.running, request)
	defer func() { s.running = s.running[:len(s.running)-1] }()
	return decisionFor(t, mustEvaluate(t, ev, event), "ladder")
}

// A posts y and B re-sends it while A is in flight. C posts z, creates bronze's
// award and fails to save. B heals that bronze, earns silver for y and loses the
// compare-and-swap to A, which counted y toward bronze: y has counted, so B's
// silver award is not held, and z's retry earns silver as the serial order y, z does.
func TestEvaluateOverlappingPostsOfOneEventEndWhereASerialRunDoes(t *testing.T) {
	ladder := func(silverCountBy string) string {
		return `{"achievements":[{"id":"ladder","title":"Ladder","description":"Guides.","tiers":[
		  {"id":"bronze","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]},
		  {"id":"silver","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":` + silverCountBy + `}]},
		  {"id":"gold","goal":1,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]}]}]}`
	}
	y, z := guideCompleted("y", "documentation"), guideCompleted("z", "learning-journey")
	for name, c := range map[string]struct {
		catalog string
		silver  string
	}{
		"silver counts kinds of guide": {ladder(`{"resource":"guide-category"}`), unitKey("guide-category", "learning-journey")},
		"every tier counts guides":     {ladder(`"resource"`), unitKey("guide", "bundled", "z")},
	} {
		t.Run(name, func(t *testing.T) {
			s := newOverlapStore()
			ev := evaluatorFor(t, c.catalog, s)
			var reported []string
			s.beforeAward["A"] = func() {
				s.beforeSave["C"] = func(Progress) (Progress, error, bool) { return Progress{}, errors.New("down"), true }
				reported = append(reported, s.post(t, ev, "C", z).Awarded...)
			}
			s.beforeSave["A"] = func(rowA Progress) (Progress, error, bool) {
				var saved Progress
				var err error
				s.beforeSave["B"] = func(Progress) (Progress, error, bool) {
					saved, err = s.fakeStore.SaveProgress(context.Background(), testPerson, rowA)
					return Progress{}, nil, false
				}
				if d := s.post(t, ev, "B", y); d.Reason != ReasonDuplicate {
					t.Errorf("B, y re-sent = %+v, want a duplicate once A's count of y is saved", d)
				}
				return saved, err, true
			}
			reported = append(reported, s.post(t, ev, "A", y).Awarded...)
			reported = append(reported, s.post(t, ev, "C retried", z).Awarded...)

			row := s.progress["ladder"]
			wantUnits := []string{c.silver, unitKey("guide", "bundled", "y")}
			slices.Sort(wantUnits)
			if !equalStrings(row.TierIDs, []string{"bronze", "silver"}) || !equalStrings(row.Units, wantUnits) || !equalStrings(row.EventIDs, []string{"evt-y", "evt-z"}) {
				t.Errorf("row = %+v, want bronze for y and silver for z, each counted once", row)
			}
			if _, gold := s.awards["ladder/gold"]; gold || len(s.awards) != 2 {
				t.Errorf("award rows = %v, want bronze and silver only", s.awards)
			}
			slices.Sort(reported)
			if !equalStrings(reported, []string{"bronze", "silver"}) {
				t.Errorf("tiers reported = %v, want each held tier once", reported)
			}
		})
	}
}

// A request whose row read predates other saves can find a stranded award whose
// event those saves counted. Holding it and earning the next tier on that view
// would leave an award row no serial order writes, so the heal is saved first
// and its lost compare-and-swap sends the request back to the saved row.
func TestEvaluateNoAwardIsCreatedAgainstAnUnsavedHeal(t *testing.T) {
	ladder := func(goals ...int) string {
		var tiers []string
		for i, goal := range goals {
			tiers = append(tiers, fmt.Sprintf(`{"id":"%s","goal":%d,"rules":[{"entity":"guides","action":"completed","countBy":"resource"}]}`,
				[]string{"bronze", "silver", "gold", "platinum"}[i], goal))
		}
		return `{"achievements":[{"id":"ladder","title":"Ladder","description":"Guides.","tiers":[` + strings.Join(tiers, ",") + `]}]}`
	}
	q, w := guideCompleted("q", "interactive"), guideCompleted("w", "interactive")
	x, z := guideCompleted("x", "interactive"), guideCompleted("z", "learning-journey")
	held := func(s *overlapStore) ([]string, []string) {
		var awards []string
		for key := range s.awards {
			awards = append(awards, strings.TrimPrefix(key, "ladder/"))
		}
		slices.Sort(awards)
		return s.progress["ladder"].TierIDs, awards
	}

	t.Run("its own re-send and another event save while it runs", func(t *testing.T) {
		s := newOverlapStore()
		ev := evaluatorFor(t, ladder(2, 1), s)
		s.seed(Progress{AchievementID: "ladder", SchemaVersion: ProgressSchemaVersion})
		s.afterLoad["Z1"] = func() {
			s.post(t, ev, "Z2", z)
			s.post(t, ev, "X", x)
		}
		if d := s.post(t, ev, "Z1", z); d.Reason != ReasonDuplicate {
			t.Errorf("Z1 = %+v, want a duplicate once its re-send is saved", d)
		}
		for _, e := range []Event{x, z} {
			s.post(t, ev, "retry", e)
		}
		if tiers, awards := held(s); !equalStrings(tiers, []string{"bronze"}) || !equalStrings(awards, []string{"bronze"}) {
			t.Errorf("held %v with award rows %v, want bronze only, as every serial order of x and z", tiers, awards)
		}
	})
	t.Run("a third event's re-run keeps no tier its stale view earned", func(t *testing.T) {
		s := newOverlapStore()
		ev := evaluatorFor(t, ladder(2, 1, 1, 1), s)
		s.seed(Progress{AchievementID: "ladder", SchemaVersion: ProgressSchemaVersion})
		s.afterLoad["Q"] = func() {
			s.afterLoad["Z1"] = func() {
				s.post(t, ev, "Z2", z)
				s.post(t, ev, "X", x)
			}
			s.post(t, ev, "Z1", z)
		}
		s.post(t, ev, "Q", q)
		s.post(t, ev, "W", w)
		for _, e := range []Event{x, z, q, w} {
			s.post(t, ev, "retry", e)
		}
		if tiers, awards := held(s); !equalStrings(tiers, []string{"bronze", "silver", "gold"}) || len(awards) != 3 {
			t.Errorf("held %v with award rows %v, want three tiers and three award rows, as every serial order of four events", tiers, awards)
		}
	})
}
