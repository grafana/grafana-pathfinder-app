package achievements

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func eventRequest(mutate func(*EventRequest)) EventRequest {
	req := EventRequest{
		SchemaVersion: 1,
		EventID:       "evt-1",
		Entity:        "dashboards",
		Action:        "created",
		OccurredAt:    fixedNow.UTC().Format(time.RFC3339),
		Context:       map[string]any{"resourceId": "uid-a", "numPanels": float64(2), "starred": true},
	}
	if mutate != nil {
		mutate(&req)
	}
	return req
}

func TestNewEventAcceptsADeclaredEvent(t *testing.T) {
	ev, err := mustRegistry(t).NewEvent(eventRequest(nil), fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if ev.ID != "evt-1" || ev.Entity != "dashboards" || ev.Action != "created" || ev.Context["resourceId"] != "uid-a" {
		t.Fatalf("event = %+v", ev)
	}
	if ev.OccurredAt.Location() != time.UTC {
		t.Fatal("occurredAt must be UTC")
	}
}

func TestNewEventWindowEdges(t *testing.T) {
	registry := mustRegistry(t)
	at := func(d time.Duration) func(*EventRequest) {
		return func(r *EventRequest) { r.OccurredAt = fixedNow.Add(d).Format(time.RFC3339Nano) }
	}
	for name, tc := range map[string]struct {
		d  time.Duration
		ok bool
	}{
		"oldest accepted":   {-30 * 24 * time.Hour, true},
		"newest accepted":   {5 * time.Minute, true},
		"just too old":      {-30*24*time.Hour - time.Second, false},
		"just too far over": {5*time.Minute + time.Second, false},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := registry.NewEvent(eventRequest(at(tc.d)), fixedNow)
			if (err == nil) != tc.ok {
				t.Fatalf("err = %v, want ok=%v", err, tc.ok)
			}
			if err != nil && !errors.Is(err, ErrInvalidEvent) {
				t.Fatalf("error must wrap ErrInvalidEvent: %v", err)
			}
		})
	}
}

func TestNewEventContextBounds(t *testing.T) {
	registry := mustRegistry(t)
	if _, err := registry.NewEvent(eventRequest(func(r *EventRequest) { r.Context = nil }), fixedNow); err != nil {
		t.Fatalf("an absent context is valid: %v", err)
	}
	long := func(r *EventRequest) {
		r.Context = map[string]any{"resourceId": strings.Repeat("x", maxContextStringBytes+1)}
	}
	if _, err := registry.NewEvent(eventRequest(long), fixedNow); !errors.Is(err, ErrInvalidEvent) {
		t.Fatalf("over-long string: %v", err)
	}
	bad := func(r *EventRequest) { r.Context = map[string]any{"starred": "yes"} }
	if _, err := registry.NewEvent(eventRequest(bad), fixedNow); !errors.Is(err, ErrInvalidEvent) {
		t.Fatalf("wrong type: %v", err)
	}
}

func TestCatalogNextAt(t *testing.T) {
	catalog := mustCatalog(t)
	if next, counted := catalog.NextAt("dash-builder", 1); !counted || next == nil || *next != 5 {
		t.Fatalf("dash-builder tier 1 = %v, %v", next, counted)
	}
	if next, counted := catalog.NextAt("dash-builder", 3); !counted || next != nil {
		t.Fatalf("dash-builder final = %v, %v", next, counted)
	}
	if _, counted := catalog.NextAt("guide-routes", 0); counted {
		t.Fatal("a milestone has no progress")
	}
	if _, counted := catalog.NextAt("retired", 0); counted {
		t.Fatal("an unknown achievement has no progress")
	}
}
