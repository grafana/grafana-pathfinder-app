package achievements

import (
	"context"
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
	if d.ID != "guides-finished" || d.Counter == nil || d.Counter.Unit != "guide" || len(d.Tiers) < 2 {
		t.Fatalf("definition = %+v", d)
	}
	m := d.Counter.Evidence[0]
	if m.Entity != "guides" || m.Action != "completed" || len(m.Where) != 0 {
		t.Errorf("evidence = %+v, want every guides.completed counted by guide", m)
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
			Context: map[string]any{"guideSource": source, "guideId": id, "guideCategory": "interactive", "completionSource": "objectives"},
		})
		if err != nil || len(decisions) != 1 {
			t.Fatalf("decisions = %+v err = %v", decisions, err)
		}
		return decisions[0]
	}

	if d := finish("bundled", "first-dashboard"); d.Decision != KindAward || d.To != 1 {
		t.Errorf("first guide = %+v", d)
	}
	if d := finish("bundled", "first-dashboard"); d.Reason != ReasonDuplicate {
		t.Errorf("same guide again = %+v", d)
	}
	if d := finish("interactive-tutorials", "first-dashboard"); d.Decision != KindIncrement || d.Units != 2 {
		t.Errorf("same id from another source = %+v, want a distinct guide", d)
	}
}
