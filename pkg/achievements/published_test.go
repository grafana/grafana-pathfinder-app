package achievements

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

func loadTestBundle(t testing.TB) *Snapshot {
	t.Helper()
	data, err := os.ReadFile("testdata/bundle.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Skipped) != 0 {
		t.Fatalf("testdata/bundle.json skipped %+v", s.Skipped)
	}
	return s
}

func TestPublishedDefinitionIsGuidesFinished(t *testing.T) {
	s := loadTestBundle(t)
	registry, catalog := s.Registry, s.Catalog
	if len(catalog.Achievements) != 1 {
		t.Fatalf("%d achievements, want the single guides-finished definition", len(catalog.Achievements))
	}
	d := catalog.Achievements[0]
	if d.ID != "guides-finished" || len(d.Tiers) < 3 {
		t.Fatalf("definition = %+v", d)
	}
	for i, want := range []string{"guides-finished-1", "guides-finished-2", "guides-finished-3"} {
		tier := d.Tiers[i]
		if tier.Art != want {
			t.Errorf("tier %s art = %q, want %q", tier.ID, tier.Art, want)
		}
		if len(tier.Rules) != 1 {
			t.Fatalf("tier %s rules = %+v, want one", tier.ID, tier.Rules)
		}
		r := tier.Rules[0]
		if r.Entity != "guides" || r.Action != "completed" || len(r.Where) != 0 || r.unit != "guide" || r.worth() != 1 {
			t.Errorf("tier %s rule = %+v, want every guides.completed counted by guide, worth 1", tier.ID, r)
		}
	}
	if _, ok := registry.action("guides", "completed"); !ok {
		t.Error("registry does not declare guides.completed")
	}
	if got := catalog.Dormant([]Pair{{"guides", "completed"}}); len(got) != 0 {
		t.Errorf("dormant with the recorder emitting guides.completed: %v", got)
	}
}

func TestPublishedDefinitionCountsDistinctGuides(t *testing.T) {
	catalog := loadTestBundle(t).Catalog
	store := newFakeStore()
	ev := NewEvaluator(catalog, store, &fakePolicy{}, func() time.Time { return fixedNow })
	finish := func(source, id string) Decision {
		t.Helper()
		decisions, err := ev.Evaluate(context.Background(), testPerson, Event{
			ID: source + id, Entity: "guides", Action: "completed",
			Context: map[string]any{"guideSource": source, "guideId": id, "guideCategory": "interactive"},
		})
		if err != nil || len(decisions) != 1 {
			t.Fatalf("decisions = %+v err = %v", decisions, err)
		}
		return decisions[0]
	}

	if d := finish("bundled", "first-dashboard"); d.Decision != KindAward || !equalStrings(d.Awarded, []string{"bronze"}) {
		t.Errorf("first guide = %+v", d)
	}
	if d := finish("bundled", "first-dashboard"); d.Reason != ReasonDuplicate {
		t.Errorf("same guide again = %+v", d)
	}
	if d := finish("interactive-tutorials", "first-dashboard"); d.Decision != KindIncrement || d.Units != 1 {
		t.Errorf("same id from another source = %+v, want a distinct guide", d)
	}
}

func TestPublishedDefinitionReachesEveryShippedTier(t *testing.T) {
	catalog := loadTestBundle(t).Catalog
	store := newFakeStore()
	ev := NewEvaluator(catalog, store, &fakePolicy{}, func() time.Time { return fixedNow })
	finish := func(n int) Decision {
		t.Helper()
		id := fmt.Sprintf("guide-%02d", n)
		decisions, err := ev.Evaluate(context.Background(), testPerson, Event{
			ID: id, Entity: "guides", Action: "completed",
			Context: map[string]any{"guideSource": "bundled", "guideId": id, "guideCategory": "interactive"},
		})
		if err != nil || len(decisions) != 1 {
			t.Fatalf("guide %d: decisions = %+v err = %v", n, decisions, err)
		}
		return decisions[0]
	}

	steps := []struct {
		guides  int
		kind    Kind
		reason  Reason
		awarded []string
		units   int
		final   bool
		next    *int
	}{
		{1, KindAward, "", []string{"bronze"}, 0, false, intp(4)},
		{4, KindIncrement, "", []string{}, 3, false, intp(4)},
		{5, KindTierUp, "", []string{"silver"}, 0, false, intp(10)},
		{14, KindIncrement, "", []string{}, 9, false, intp(10)},
		{15, KindAward, "", []string{"gold"}, 0, true, nil},
		{16, KindIgnored, ReasonComplete, []string{}, 0, true, nil},
	}
	n := 0
	for _, step := range steps {
		var d Decision
		for n < step.guides {
			n++
			d = finish(n)
		}
		if d.Decision != step.kind || d.Reason != step.reason || !equalStrings(d.Awarded, step.awarded) || d.Units != step.units || d.Final != step.final {
			t.Errorf("guide %d = %+v, want %s %q awarded=%v units=%d final=%v", n, d, step.kind, step.reason, step.awarded, step.units, step.final)
		}
		if (d.Next == nil) != (step.next == nil) || (d.Next != nil && *d.Next != *step.next) {
			t.Errorf("guide %d next = %v, want %v", n, d.Next, step.next)
		}
	}
	for _, tierID := range []string{"bronze", "silver", "gold"} {
		if _, ok := store.awards["guides-finished/"+tierID]; !ok {
			t.Errorf("no award for tier %s", tierID)
		}
	}
	if len(store.awards) != 3 {
		t.Errorf("%d awards, want one per tier", len(store.awards))
	}
}

func TestPublishedDefinitionCountsTheRecordersLongestGuideID(t *testing.T) {
	catalog := loadTestBundle(t).Catalog
	ev := NewEvaluator(catalog, newFakeStore(), &fakePolicy{}, func() time.Time { return fixedNow })
	decisions, err := ev.Evaluate(context.Background(), testPerson, Event{
		ID: "long", Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": string(repeatByte('s', 256)), "guideId": string(repeatByte('i', 256)), "guideCategory": "interactive"},
	})
	if err != nil || len(decisions) != 1 || decisions[0].Decision != KindAward {
		t.Errorf("decisions = %+v err = %v, want one counted guide", decisions, err)
	}
}
