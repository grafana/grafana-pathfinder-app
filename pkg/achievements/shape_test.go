package achievements

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	for _, tc := range []struct {
		name string
		row  Progress
		want Shape
	}{
		{"never stored", Progress{}, ShapeCurrent},
		{"current", Progress{SchemaVersion: ProgressSchemaVersion}, ShapeCurrent},
		{"version 1", Progress{SchemaVersion: 1}, ShapeRepairable},
		{"current missing points", Progress{SchemaVersion: ProgressSchemaVersion, MissingFields: []string{FieldPoints}}, ShapeRepairable},
		{"newer", Progress{SchemaVersion: ProgressSchemaVersion + 1}, ShapeNewer},
	} {
		if got := Classify(tc.row); got != tc.want {
			t.Errorf("%s: shape = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNormalize(t *testing.T) {
	for _, tc := range []struct {
		name string
		row  Progress
		want Progress
	}{
		{"version 1 drops the ledger and keeps tiers", Progress{AchievementID: "a", TierIDs: []string{"bronze"}, Units: []string{"x"}, Points: 3, SchemaVersion: 1, Version: "9"},
			Progress{AchievementID: "a", TierIDs: []string{"bronze"}, SchemaVersion: ProgressSchemaVersion, Version: "9"}},
		{"missing points keeps the ledger", Progress{TierIDs: []string{"bronze"}, Units: []string{"x"}, SchemaVersion: ProgressSchemaVersion, MissingFields: []string{FieldPoints}},
			Progress{TierIDs: []string{"bronze"}, Units: []string{"x"}, SchemaVersion: ProgressSchemaVersion}},
	} {
		got := Normalize(tc.row)
		if got.AchievementID != tc.want.AchievementID || !slices.Equal(got.TierIDs, tc.want.TierIDs) || !slices.Equal(got.Units, tc.want.Units) ||
			got.Points != tc.want.Points || got.SchemaVersion != tc.want.SchemaVersion || got.Version != tc.want.Version || len(got.MissingFields) != 0 {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
	if got := Normalize(Progress{SchemaVersion: ProgressSchemaVersion + 1, Points: 4}); got.SchemaVersion != ProgressSchemaVersion+1 || got.Points != 4 {
		t.Errorf("a newer row changed: %+v", got)
	}
}

func TestEvaluateRepairsAMissingPointsRowBeforeCounting(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: ProgressSchemaVersion, MissingFields: []string{FieldPoints}})
	decisions, err := newTestEvaluator(t, store, &fakePolicy{}).Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	row := store.progress["dash-builder"]
	if d := decisionFor(t, decisions, "dash-builder"); d.Units != 1 || store.saves != 2 || Classify(row) != ShapeCurrent {
		t.Errorf("decision = %+v saves = %d row = %+v, want a repair save then one counted point", d, store.saves, row)
	}
}

func TestEvaluateReloadsAfterAConflictDuringTheRepairSave(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: 1})
	store.beforeSave = func(s *fakeStore, attempt int) {
		if attempt == 1 {
			s.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: ProgressSchemaVersion})
		}
	}
	decisions, err := newTestEvaluator(t, store, &fakePolicy{}).Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Units != 1 || store.saves != 2 {
		t.Errorf("decision = %+v saves = %d, want the healed row reloaded and one repair attempt skipped", d, store.saves)
	}
}

func TestEvaluateRefusesToCountWhenTheKindDropsAField(t *testing.T) {
	store := newFakeStore()
	store.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: ProgressSchemaVersion, MissingFields: []string{FieldPoints}})
	store.saveErr = errors.Join(ErrFieldUnserved)
	decisions, err := newTestEvaluator(t, store, &fakePolicy{}).Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonStoreUnavailable || store.awardCalls != 0 || len(store.progress["dash-builder"].Units) != 0 {
		t.Errorf("decision = %+v, want store_unavailable with nothing spent", d)
	}
}

type unreadableAckStore struct{ *fakeStore }

func (s unreadableAckStore) SaveProgress(ctx context.Context, person Person, p Progress) (Progress, error) {
	saved, err := s.fakeStore.SaveProgress(ctx, person, p)
	saved.Version = ""
	return saved, err
}

func TestEvaluateReReadsTheRowWhenTheRepairAcknowledgementIsUnreadable(t *testing.T) {
	fake := newFakeStore()
	fake.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: 1})
	ev := NewEvaluator(mustCatalog(t), unreadableAckStore{fake}, &fakePolicy{}, func() time.Time { return fixedNow })
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Units != 1 || Classify(fake.progress["dash-builder"]) != ShapeCurrent {
		t.Errorf("decision = %+v, want the re-read row repaired and the event counted", d)
	}
}

type pruningStore struct{ *fakeStore }

func (s pruningStore) SaveProgress(ctx context.Context, person Person, p Progress) (Progress, error) {
	p.MissingFields = []string{FieldPoints}
	saved, err := s.fakeStore.SaveProgress(ctx, person, p)
	saved.Version = ""
	return saved, err
}

func TestEvaluateSpendsNothingWhenAnUnreadableAcknowledgementHidesAPruningKind(t *testing.T) {
	fake := newFakeStore()
	fake.seed(Progress{AchievementID: "dash-builder", TierIDs: []string{"bronze"}, SchemaVersion: ProgressSchemaVersion, MissingFields: []string{FieldPoints}})
	ev := NewEvaluator(mustCatalog(t), pruningStore{fake}, &fakePolicy{}, func() time.Time { return fixedNow })
	decisions, err := ev.Evaluate(context.Background(), testPerson, dashboardCreated("a", 1))
	if err != nil {
		t.Fatal(err)
	}
	if d := decisionFor(t, decisions, "dash-builder"); d.Reason != ReasonStoreUnavailable {
		t.Errorf("decision = %+v, want store_unavailable", d)
	}
	if fake.saves != maxAttempts || fake.awardCalls != 0 || len(fake.progress["dash-builder"].Units) != 0 {
		t.Errorf("saves = %d awards = %d units = %v, want %d bounded repair saves and nothing spent", fake.saves, fake.awardCalls, fake.progress["dash-builder"].Units, maxAttempts)
	}
}
