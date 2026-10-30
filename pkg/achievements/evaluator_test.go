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
	if got := strings.Join(ids, ","); got != "dash-builder,well-rounded,guide-routes" {
		t.Fatalf("decisions for %s", got)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonConditionNotMet {
		t.Errorf("dash-builder = %+v", d)
	}
	if d := decisionFor(t, decisions, "guide-routes"); d.Decision != KindAward || d.To != 1 {
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
	if d.Decision != KindAward || d.To != 1 || d.Units != 1 {
		t.Fatalf("decision = %+v", d)
	}
	row := store.progress["dash-builder"]
	if row.Tier != 1 || !equalStrings(row.Units, []string{"a"}) || row.Revision != 1 {
		t.Errorf("stored progress = %+v", row)
	}
	award, ok := store.awards["dash-builder/1"]
	if !ok || award.Route != "dashboards" || award.Revision != 1 {
		t.Fatalf("award = %+v ok=%v", award, ok)
	}
	if !award.EarnedAt.Equal(fixedNow) || award.EarnedAt.Location() != time.UTC {
		t.Errorf("earnedAt = %v, want the plugin clock in UTC", award.EarnedAt)
	}
}

func TestEvaluateAwardsEveryTierUpToTheNewOne(t *testing.T) {
	store := newFakeStore()
	ev := newTestEvaluator(t, store, &fakePolicy{})
	if _, err := ev.Evaluate(context.Background(), testPerson, guideCompleted("expert", "interactive")); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"guide-routes/1", "guide-routes/2"} {
		if a, ok := store.awards[key]; !ok || a.Route != "guides" {
			t.Errorf("award %s = %+v ok=%v", key, a, ok)
		}
	}
	if len(store.awards) != 2 {
		t.Errorf("%d awards, want 2", len(store.awards))
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
		store.seed(Progress{AchievementID: "dash-builder", Tier: 1, Units: []string{"a"}, Revision: 1})
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("b", 1))
		if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindIncrement || d.Units != 2 {
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
		if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindIncrement || d.Units != 2 || d.From != 1 {
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
		s.seed(Progress{AchievementID: "dash-builder", Tier: 1, Units: []string{"a"}, Revision: 1})
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
			if d.Decision != KindIgnored || d.Reason != tc.wantReason || d.From != 0 || d.To != 0 {
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

func TestEvaluateAwardCreateExistingStillReportsAward(t *testing.T) {
	store := newFakeStore()
	store.awards["dash-builder/1"] = Award{AchievementID: "dash-builder", Tier: 1}
	ev := newTestEvaluator(t, store, &fakePolicy{})
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindAward || d.To != 1 {
		t.Errorf("decision = %+v, want award despite the 409", d)
	}
	if store.progress["dash-builder"].Tier != 1 {
		t.Error("progress was not saved after the existing award")
	}
}

func TestEvaluateRetryAfterPartialFailureReportsTheSameDecision(t *testing.T) {
	store := newFakeStore()
	store.saveErr = errors.New("down")
	ev := newTestEvaluator(t, store, &fakePolicy{})
	event := dashboardCreated("a", 1)
	if _, err := ev.Evaluate(context.Background(), testPerson, event); err != nil {
		t.Fatal(err)
	}
	if len(store.awards) != 1 || store.progress["dash-builder"].Tier != 0 {
		t.Fatalf("setup: awards=%d tier=%d", len(store.awards), store.progress["dash-builder"].Tier)
	}
	store.saveErr = nil
	decisions, _ := ev.Evaluate(context.Background(), testPerson, event)
	if d := decisionFor(t, decisions, "dash-builder"); d.Decision != KindAward || d.To != 1 {
		t.Errorf("retry = %+v", d)
	}
}

func TestEvaluateConflict(t *testing.T) {
	t.Run("another replica counted the same unit: one count, one duplicate", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				s.seed(Progress{AchievementID: "dash-builder", Tier: 1, Units: []string{"a"}, Revision: 1})
			}
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		d := decisionFor(t, decisions, "dash-builder")
		if d.Decision != KindIgnored || d.Reason != ReasonDuplicate || d.Units != 1 {
			t.Errorf("decision = %+v", d)
		}
		if store.saves != 1 {
			t.Errorf("saves = %d, want the re-run to need no second write", store.saves)
		}
	})
	t.Run("another replica counted a different unit: re-run merges", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, attempt int) {
			if attempt == 1 {
				s.seed(Progress{AchievementID: "dash-builder", Tier: 1, Units: []string{"z"}, Revision: 1})
			}
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		d := decisionFor(t, decisions, "dash-builder")
		if d.Decision != KindIncrement || d.Units != 2 || d.From != 1 {
			t.Errorf("decision = %+v", d)
		}
		if got := store.progress["dash-builder"].Units; !equalStrings(got, []string{"a", "z"}) {
			t.Errorf("ledger = %v", got)
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
	})
	t.Run("reload failure during a conflict is store_unavailable", func(t *testing.T) {
		store := newFakeStore()
		store.beforeSave = func(s *fakeStore, _ int) {
			s.seed(s.progress["dash-builder"])
			s.loadErr = errors.New("down")
		}
		ev := newTestEvaluator(t, store, &fakePolicy{})
		store.seed(Progress{AchievementID: "dash-builder", Revision: 1})
		decisions, _ := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
		store.loadErr = nil
		if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonStoreUnavailable {
			t.Errorf("decision = %+v", d)
		}
	})
}

func TestEvaluateRecordNewerIsTransientAndUntouched(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "dash-builder", Tier: 2, Units: []string{"a"}, Revision: 9, SchemaVersion: SchemaVersion + 1})
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
	got := decisionJSON(t, Decision{AchievementID: "x", Decision: KindIncrement, From: 1, To: 1, Units: 2, Next: intp(5), Revision: 1})
	if want := `{"achievementId":"x","decision":"increment","from":1,"to":1,"final":false,"units":2,"next":5,"revision":1}`; got != want {
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
