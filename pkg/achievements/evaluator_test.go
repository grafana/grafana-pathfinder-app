package achievements

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func newTestEvaluator(t *testing.T, store *fakeStore, policy *fakePolicy) *Evaluator {
	t.Helper()
	return NewEvaluator(mustCatalog(t), store, policy, func() time.Time { return fixedNow })
}

var testPerson = Person{ID: "user-1"}

func decisionFor(t *testing.T, decisions []Decision, id string) Decision {
	t.Helper()
	for _, d := range decisions {
		if d.AchievementID == id {
			return d
		}
	}
	t.Fatalf("no decision for %q in %+v", id, decisions)
	return Decision{}
}

func TestEvaluatePolicyRefusalIsAnErrorWithNoIO(t *testing.T) {
	store := newFakeStore()
	refusal := errors.New("rate limited")
	ev := newTestEvaluator(t, store, &fakePolicy{err: refusal})
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if !errors.Is(err, refusal) || decisions != nil {
		t.Fatalf("got %+v, %v; want the policy error and no decisions", decisions, err)
	}
	if store.calls() != 0 {
		t.Errorf("store touched %d times after a refusal", store.calls())
	}
}

func TestEvaluateNoSelectionReturnsEmptyArrayWithNoStoreIO(t *testing.T) {
	store := newFakeStore()
	policy := &fakePolicy{}
	ev := newTestEvaluator(t, store, policy)
	decisions, err := ev.Evaluate(context.Background(), testPerson, Event{ID: "e", Entity: "dashboards", Action: "deleted"})
	if err != nil {
		t.Fatal(err)
	}
	if decisions == nil || len(decisions) != 0 {
		t.Fatalf("decisions = %#v, want a non-nil empty slice", decisions)
	}
	if b, _ := json.Marshal(decisions); string(b) != "[]" {
		t.Errorf("marshals as %s, want []", b)
	}
	if store.calls() != 0 || policy.calls != 1 {
		t.Errorf("store calls = %d, policy calls = %d", store.calls(), policy.calls)
	}
}

func TestEvaluateSelectsInCatalogOrderOneDecisionEach(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, guideCompleted("intro", "interactive"))
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, d := range decisions {
		ids = append(ids, d.AchievementID)
	}
	if got := strings.Join(ids, ","); got != "dash-builder,well-rounded,journey,guide-routes" {
		t.Fatalf("decisions for %s", got)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonConditionNotMet {
		t.Errorf("dash-builder = %+v", d)
	}
	if d := decisionFor(t, decisions, "guide-routes"); d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Errorf("guide-routes = %+v", d)
	}
}

func TestEvaluateCreatesMissingProgressAndAward(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 2))
	if err != nil {
		t.Fatal(err)
	}
	d := decisionFor(t, decisions, "dash-builder")
	if d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) || d.Units != 0 || d.Next == nil || *d.Next != 4 {
		t.Fatalf("decision = %+v", d)
	}
	row := store.progress["dash-builder"]
	if !equalStrings(row.TierIDs, []string{"bronze"}) || !equalStrings(row.Units, dash("a")) || row.Points != 0 || row.SchemaVersion != ProgressSchemaVersion {
		t.Errorf("stored progress = %+v", row)
	}
	award, ok := store.awards["dash-builder/bronze"]
	if !ok || award.Entity != "dashboards" {
		t.Fatalf("award = %+v ok=%v", award, ok)
	}
	if !award.EarnedAt.Equal(fixedNow) || award.EarnedAt.Location() != time.UTC {
		t.Errorf("earnedAt = %v, want the plugin clock in UTC", award.EarnedAt)
	}
}

func TestEvaluateEarnsOneTierPerEvent(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	for _, step := range []struct {
		guide   string
		awarded []string
	}{
		{"expert", []string{}},
		{"intro", []string{"bronze"}},
		{"advanced", []string{"silver"}},
	} {
		decisions, err := ev.Evaluate(context.Background(), testPerson, guideCompleted(step.guide, "interactive"))
		if err != nil {
			t.Fatal(err)
		}
		if d := decisionFor(t, decisions, "guide-routes"); !equalStrings(d.Awarded, step.awarded) {
			t.Errorf("%s = %+v, want %v awarded", step.guide, d, step.awarded)
		}
	}
	if len(store.awards) != 2 || store.awards["guide-routes/silver"].Entity != "guides" {
		t.Errorf("awards = %+v, want bronze and silver", store.awards)
	}
	if row := store.progress["guide-routes"]; !equalStrings(row.Units, []string{unitKey("guide", "bundled", "intro"), unitKey("guide", "bundled", "advanced")}) {
		t.Errorf("ledger = %v, want only the guides that counted", row.Units)
	}
}

func TestEvaluateReplayChangesNothing(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	event := dashboardCreated("a", 1)
	if _, err := ev.Evaluate(context.Background(), testPerson, event); err != nil {
		t.Fatal(err)
	}
	savesBefore := store.saves
	decisions, err := ev.Evaluate(context.Background(), testPerson, event)
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindIgnored || d.Reason != ReasonDuplicate {
		t.Errorf("replay = %+v", d)
	}
	if store.saves != savesBefore || len(store.awards) != 1 {
		t.Errorf("replay wrote: saves %d -> %d, awards %d", savesBefore, store.saves, len(store.awards))
	}
}

func TestEvaluateExistingProgressRowIsReusedAndExistingCreateReloads(t *testing.T) {
	t.Run("loaded row skips create", func(t *testing.T) {
		store := newFakeStore()
		store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: dash("a")})
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("b", 1))
		if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindIncrement || d.Units != 1 {
			t.Errorf("decision = %+v", d)
		}
		if store.creates != 0 {
			t.Errorf("created %d rows for an existing one", store.creates)
		}
	})
	t.Run("409 on create reloads the row another replica made", func(t *testing.T) {
		store := newFakeStore()
		inner := &raceStore{fakeStore: store}
		ev := NewEvaluator(mustCatalog(t), inner, &fakePolicy{}, func() time.Time { return fixedNow })
		decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("b", 1))
		if err != nil {
			t.Fatal(err)
		}
		if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindIncrement || d.Units != 1 || !equalStrings(d.Awarded, []string{}) {
			t.Errorf("decision = %+v", d)
		}
	})
}

// raceStore reports no row on the first load, then has another replica create it.
type raceStore struct {
	*fakeStore
	raced bool
}

func (s *raceStore) LoadProgress(ctx context.Context, p Person, ids []string) (map[string]Progress, error) {
	if !s.raced {
		s.raced = true
		s.loads++
		s.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: dash("a")})
		return map[string]Progress{}, nil
	}
	return s.fakeStore.LoadProgress(ctx, p, ids)
}

func TestEvaluateStoreFailuresAreTransientDecisions(t *testing.T) {
	boom := errors.New("boom")
	cases := []struct {
		name       string
		setup      func(*fakeStore)
		wantSaves  int
		wantReason Reason
	}{
		{"load fails", func(s *fakeStore) { s.loadErr = boom }, 0, ReasonStoreUnavailable},
		{"create progress fails", func(s *fakeStore) { s.createProgressErr = boom }, 0, ReasonStoreUnavailable},
		{"award create fails", func(s *fakeStore) { s.awardErr = boom }, 0, ReasonStoreUnavailable},
		{"save fails", func(s *fakeStore) { s.saveErr = boom }, 1, ReasonStoreUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			tc.setup(store)
			ev := newTestEvaluator(t, store, &fakePolicy{})
			decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
			if err != nil {
				t.Fatal(err)
			}
			d := decisionFor(t, decisions, "dash-builder")
			if d.Decision != KindIgnored || d.Reason != tc.wantReason || len(d.Awarded) != 0 {
				t.Errorf("decision = %+v", d)
			}
			if !Retry(decisions) {
				t.Error("a transient decision must keep the event queued")
			}
			if store.saves != tc.wantSaves {
				t.Errorf("saves = %d, want %d", store.saves, tc.wantSaves)
			}
		})
	}
}

func TestEvaluateReportsAnExistingAwardRowTheHeldSetLacks(t *testing.T) {
	store := newFakeStore()
	store.awards["dash-builder/bronze"] = Award{AchievementID: "dash-builder", TierID: "bronze"}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"achievementId":"dash-builder","decision":"award","awarded":["bronze"],"final":false,"units":0,"next":4}`
	if got := decisionJSON(t, decisionFor(t, decisions, "dash-builder")); got != want {
		t.Errorf("decision\n got %s\nwant %s", got, want)
	}
	if !equalStrings(store.progress["dash-builder"].TierIDs, []string{"bronze"}) || len(store.awards) != 1 {
		t.Errorf("held = %v awards = %d", store.progress["dash-builder"].TierIDs, len(store.awards))
	}
}

func TestEvaluateReportsATierUpWhoseAwardRowExisted(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "guide-routes", TierIDs: []string{"bronze"}})
	store.awards["guide-routes/bronze"] = Award{AchievementID: "guide-routes", TierID: "bronze"}
	store.awards["guide-routes/silver"] = Award{AchievementID: "guide-routes", TierID: "silver"}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, guideCompleted("expert", "interactive"))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"achievementId":"guide-routes","decision":"award","awarded":["silver"],"final":true,"units":0,"next":null}`
	if got := decisionJSON(t, decisionFor(t, decisions, "guide-routes")); got != want {
		t.Errorf("decision\n got %s\nwant %s", got, want)
	}
	if !equalStrings(store.progress["guide-routes"].TierIDs, []string{"bronze", "silver"}) {
		t.Errorf("held = %v", store.progress["guide-routes"].TierIDs)
	}
}

func TestEvaluateTierAlreadyHeldIsNotReportedAgain(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "guide-routes", TierIDs: []string{"bronze"}})
	store.awards["guide-routes/bronze"] = Award{AchievementID: "guide-routes", TierID: "bronze"}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, guideCompleted("expert", "interactive"))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"achievementId":"guide-routes","decision":"award","awarded":["silver"],"final":true,"units":0,"next":null}`
	if got := decisionJSON(t, decisionFor(t, decisions, "guide-routes")); got != want {
		t.Errorf("decision\n got %s\nwant %s", got, want)
	}
}

func TestEvaluateRetryAfterAFailedSaveReportsTheAwardTheFirstTryCreated(t *testing.T) {
	store := newFakeStore()
	store.saveErr = errors.New("down")
	ev := newTestEvaluator(t, store, &fakePolicy{})
	event := dashboardCreated("a", 1)
	if _, err := ev.Evaluate(context.Background(), testPerson, event); err != nil {
		t.Fatal(err)
	}
	if len(store.awards) != 1 || len(store.progress["dash-builder"].TierIDs) != 0 {
		t.Fatalf("setup: awards=%d held=%v", len(store.awards), store.progress["dash-builder"].TierIDs)
	}
	store.saveErr = nil
	decisions, _ := ev.Evaluate(context.Background(), testPerson, event)
	if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Errorf("retry = %+v, want the unit counted and bronze reported", d)
	}
	if !equalStrings(store.progress["dash-builder"].TierIDs, []string{"bronze"}) || len(store.awards) != 1 {
		t.Errorf("held = %v awards = %d", store.progress["dash-builder"].TierIDs, len(store.awards))
	}
}

func TestEvaluateRetryAfterAFailedAwardCreateReportsTheTier(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "guide-routes", TierIDs: []string{"bronze"}})
	store.awardErrFor = map[string]error{"guide-routes/silver": errors.New("down")}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	event := guideCompleted("expert", "interactive")
	decisions, _ := ev.Evaluate(context.Background(), testPerson, event)
	if d := decisionFor(t, decisions, "guide-routes"); d.Reason != ReasonStoreUnavailable || len(d.Awarded) != 0 || !Retry(decisions) {
		t.Fatalf("first try = %+v, want a transient store_unavailable", d)
	}
	if row := store.progress["guide-routes"]; !equalStrings(row.TierIDs, []string{"bronze"}) || len(row.Units) != 0 {
		t.Fatalf("row = %+v, want progress untouched", row)
	}

	store.awardErrFor = nil
	decisions, _ = ev.Evaluate(context.Background(), testPerson, event)
	want := `{"achievementId":"guide-routes","decision":"award","awarded":["silver"],"final":true,"units":0,"next":null}`
	if got := decisionJSON(t, decisionFor(t, decisions, "guide-routes")); got != want {
		t.Errorf("retry\n got %s\nwant %s", got, want)
	}
	if len(store.awards) != 1 || !equalStrings(store.progress["guide-routes"].TierIDs, []string{"bronze", "silver"}) {
		t.Errorf("awards = %d held = %v", len(store.awards), store.progress["guide-routes"].TierIDs)
	}

	decisions, _ = ev.Evaluate(context.Background(), testPerson, event)
	if d := decisionFor(t, decisions, "guide-routes"); d.Reason != ReasonComplete || len(d.Awarded) != 0 {
		t.Errorf("replay = %+v, want nothing reported once every tier is held", d)
	}
}

func TestEvaluateConflict(t *testing.T) {
	t.Run("a tier the reloaded row still lacks is reported after the re-run", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				s.seed(Progress{AchievementID: "dash-builder", Units: dash("z")})
			}
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) || d.Units != 0 {
			t.Errorf("decision = %+v, want bronze reported once", d)
		}
		if store.saves != 2 || len(store.awards) != 1 {
			t.Errorf("saves = %d awards = %d", store.saves, len(store.awards))
		}
	})
	t.Run("the same event on two replicas: one count and one duplicate", func(t *testing.T) {
		store := newFakeStore()
		store.seed(Progress{AchievementID: "dash-builder"})
		replica := newTestEvaluator(t, store, &fakePolicy{})
		var winner []Decision
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				winner, _ = replica.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
			}
		}
		loser, _ := newTestEvaluator(t, store, &fakePolicy{}).Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		if d := decisionFor(t, winner, "dash-builder"); d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) {
			t.Errorf("winner = %+v, want bronze reported though its award create returned 409", d)
		}
		if d := decisionFor(t, loser, "dash-builder"); d.Decision != KindIgnored || d.Reason != ReasonDuplicate || len(d.Awarded) != 0 || d.Next == nil || *d.Next != 4 {
			t.Errorf("loser = %+v, want duplicate though its award create returned 201", d)
		}
		if row := store.progress["dash-builder"]; !equalStrings(row.Units, dash("a")) || len(store.awards) != 1 || store.saves != 2 {
			t.Errorf("ledger = %v awards = %d saves = %d", row.Units, len(store.awards), store.saves)
		}
	})
	t.Run("another replica earned the tier first: the re-run counts the unit toward the next tier", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				s.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, Units: dash("z")})
			}
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		d := decisionFor(t, decisions, "dash-builder")
		if d.Decision != KindIncrement || d.Units != 1 || len(d.Awarded) != 0 {
			t.Errorf("decision = %+v", d)
		}
		if got := store.progress["dash-builder"]; !equalStrings(got.Units, dash("a", "z")) || got.Points != 1 {
			t.Errorf("row = %+v, want both units and one point toward silver", got)
		}
	})
	t.Run("a replica counted the same unit at a lower worth: the award this event wrote stays held", func(t *testing.T) {
		store := newFakeStore()
		store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze", "silver"}, Points: 8, SchemaVersion: ProgressSchemaVersion})
		replica := newTestEvaluator(t, store, &fakePolicy{})
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				s.beforeSave = nil
				if d := decisionFor(t, mustEvaluate(t, replica, dashboardCreated("x", 3)), "dash-builder"); d.Decision != KindIncrement || d.Units != 9 {
					t.Fatalf("replica = %+v, want the worth-1 count saved first", d)
				}
			}
		}
		decisions := mustEvaluate(t, newTestEvaluator(t, store, &fakePolicy{}), starredDashboard("x", 3))
		want := `{"achievementId":"dash-builder","decision":"award","awarded":["gold"],"final":true,"units":0,"next":null}`
		if got := decisionJSON(t, decisionFor(t, decisions, "dash-builder")); got != want {
			t.Errorf("decision\n got %s\nwant %s", got, want)
		}
		row := store.progress["dash-builder"]
		if !equalStrings(row.TierIDs, []string{"bronze", "silver", "gold"}) || row.Points != 0 || !equalStrings(row.Units, dash("x")) {
			t.Errorf("row = %+v, want gold held, points reset and the unit counted once", row)
		}
		if _, ok := store.awards["dash-builder/gold"]; !ok || len(store.awards) != 1 {
			t.Errorf("awards = %+v", store.awards)
		}
	})
	t.Run("five conflicts give a transient conflict", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, _ int) {
			row := s.progress["dash-builder"]
			s.seed(row)
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		d := decisionFor(t, decisions, "dash-builder")
		if d.Decision != KindIgnored || d.Reason != ReasonConflict {
			t.Errorf("decision = %+v", d)
		}
		if store.saves != 5 || !Retry(decisions) {
			t.Errorf("saves = %d retry = %v, want 5 attempts and a retry", store.saves, Retry(decisions))
		}
		if store.loads != 5 {
			t.Errorf("loads = %d, want the first load and one reload after each of the first four conflicts", store.loads)
		}
	})
	t.Run("reload failure during a conflict is store_unavailable", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, _ int) {
			s.seed(s.progress["dash-builder"])
			s.loadErr = errors.New("down")
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		store.seed(Progress{AchievementID: "dash-builder"})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		store.loadErr = nil
		if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonStoreUnavailable {
			t.Errorf("decision = %+v", d)
		}
	})
}

func mustEvaluate(t *testing.T, ev *Evaluator, event Event) []Decision {
	t.Helper()
	decisions, err := ev.Evaluate(context.Background(), testPerson, event)
	if err != nil {
		t.Fatal(err)
	}
	return decisions
}

func TestEvaluateRecordNewerIsTransientAndUntouched(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze", "silver"}, Units: dash("a"), SchemaVersion: ProgressSchemaVersion + 1})
	before := store.progress["dash-builder"]
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("b", 1))
	d := decisionFor(t, decisions, "dash-builder")
	if d.Reason != ReasonRecordNewer || !Retry(decisions) {
		t.Errorf("decision = %+v retry=%v", d, Retry(decisions))
	}
	if store.saves != 0 || store.awardCalls != 0 || store.progress["dash-builder"].Version != before.Version {
		t.Error("a newer-schema record was modified")
	}
}

func TestEvaluateRecordNewerOnAConflictReRunStaysTransient(t *testing.T) {
	store := newFakeStore()
	store.beforeSave = func(s *fakeStore, attempt int) {
		if attempt == 1 {
			s.seed(Progress{AchievementID: "dash-builder", SchemaVersion: ProgressSchemaVersion + 1})
		}
	}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	d := decisionFor(t, decisions, "dash-builder")
	if d.Reason != ReasonRecordNewer || !Retry(decisions) {
		t.Errorf("decision = %+v retry=%v, want record_newer and a retry", d, Retry(decisions))
	}
	if row := store.progress["dash-builder"]; len(row.Units) != 0 || store.saves != 1 {
		t.Errorf("row = %+v saves = %d, want the newer row left untouched", row, store.saves)
	}
}

func TestEvaluateUnmatchedEventStillCreatesTheRow(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 0))
	if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonConditionNotMet {
		t.Fatalf("decision = %+v", d)
	}
	if _, ok := store.progress["dash-builder"]; !ok {
		t.Error("RFC §6.3 step 3 creates a missing row before the event is evaluated")
	}
}

func TestDecisionJSONShape(t *testing.T) {
	got := decisionJSON(t, Decision{AchievementID: "x", Decision: KindTierUp, Awarded: []string{"silver"}, Units: 5, Next: intp(25)})
	if want := `{"achievementId":"x","decision":"tier_up","awarded":["silver"],"final":false,"units":5,"next":25}`; got != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
}

func TestReasonTransient(t *testing.T) {
	transient := map[Reason]bool{ReasonConflict: true, ReasonRecordNewer: true, ReasonStoreUnavailable: true}
	for _, r := range []Reason{ReasonDuplicate, ReasonComplete, ReasonConditionNotMet, ReasonInvalidContext, ReasonConflict, ReasonRecordNewer, ReasonStoreUnavailable} {
		if r.Transient() != transient[r] {
			t.Errorf("%s transient = %v", r, r.Transient())
		}
	}
	if Retry([]Decision{{Reason: ReasonDuplicate}}) {
		t.Error("a non-transient reason must not retry")
	}
}
