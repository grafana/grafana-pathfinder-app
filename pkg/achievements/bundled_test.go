package achievements

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestBundledDefinitionIsGuidesFinished(t *testing.T) {
	registry, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Achievements) != 1 {
		t.Fatalf("%d achievements, want the single guides-finished definition", len(catalog.Achievements))
	}
	d := catalog.Achievements[0]
	if d.ID != "guides-finished" || d.Counter == nil || d.Counter.Unit != "guide" || len(d.Tiers) < 3 {
		t.Fatalf("definition = %+v", d)
	}
	m := d.Counter.Evidence[0]
	if m.Entity != "guides" || m.Action != "completed" || len(m.Where) != 0 {
		t.Errorf("evidence = %+v, want every guides.completed counted by guide", m)
	}
	for i, want := range []string{"guides-finished-1", "guides-finished-2", "guides-finished-3"} {
		if d.Tiers[i].Art != want {
			t.Errorf("tier %s art = %q, want %q", d.Tiers[i].ID, d.Tiers[i].Art, want)
		}
	}
	if _, ok := registry.action("guides", "completed"); !ok {
		t.Error("registry does not declare guides.completed")
	}
	if got := catalog.Dormant([]Pair{{"guides", "completed"}}); len(got) != 0 {
		t.Errorf("dormant with the recorder emitting guides.completed: %v", got)
	}
}

func TestBundledDefinitionCountsDistinctGuides(t *testing.T) {
	_, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
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
	if d := finish("interactive-tutorials", "first-dashboard"); d.Decision != KindIncrement || d.Units != 2 {
		t.Errorf("same id from another source = %+v, want a distinct guide", d)
	}
}

func TestBundledDefinitionReachesEveryShippedTier(t *testing.T) {
	_, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
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
		{1, KindAward, "", []string{"bronze"}, 1, false, intp(5)},
		{4, KindIncrement, "", []string{}, 4, false, intp(5)},
		{5, KindTierUp, "", []string{"silver"}, 5, false, intp(15)},
		{14, KindIncrement, "", []string{}, 14, false, intp(15)},
		{15, KindAward, "", []string{"gold"}, 15, true, nil},
		{16, KindIncrement, "", []string{}, 16, true, nil},
		{maxThreshold, KindIncrement, "", []string{}, maxThreshold, true, nil},
		{maxThreshold + 1, KindIgnored, ReasonComplete, []string{}, maxThreshold, true, nil},
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

func TestBundledDefinitionCountsTheRecordersLongestGuideID(t *testing.T) {
	_, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
	ev := NewEvaluator(catalog, newFakeStore(), &fakePolicy{}, func() time.Time { return fixedNow })
	decisions, err := ev.Evaluate(context.Background(), testPerson, Event{
		ID: "long", Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": string(repeatByte('s', 256)), "guideId": string(repeatByte('i', 256)), "guideCategory": "interactive"},
	})
	if err != nil || len(decisions) != 1 || decisions[0].Decision != KindAward || decisions[0].Units != 1 {
		t.Errorf("decisions = %+v err = %v, want one counted guide", decisions, err)
	}
}
