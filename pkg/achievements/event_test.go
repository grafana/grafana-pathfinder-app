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

func TestCatalogToward(t *testing.T) {
	catalog := mustCatalog(t)
	row := func(points int, held ...string) Progress {
		return Progress{AchievementID: "dash-builder", TierIDs: held, Points: points}
	}
	for _, tc := range []struct {
		name    string
		row     Progress
		awarded []string
		units   int
		next    *int
		known   bool
	}{
		{"points toward the lowest tier not held", row(3, "bronze"), nil, 3, intp(4), true},
		{"a tier missing below a held one is the next", row(2, "bronze", "gold"), nil, 2, intp(4), true},
		{"every tier held", row(0, "gold", "silver", "bronze"), nil, 0, nil, true},
		{"an award the row lags drops the row's points", row(3, "bronze"), []string{"silver"}, 0, intp(10), true},
		{"an award the row records keeps them", row(3, "bronze"), []string{"bronze"}, 3, intp(4), true},
		{"an unknown achievement", Progress{AchievementID: "retired", Points: 1}, nil, 0, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			units, next, known := catalog.Toward(tc.row, tc.awarded)
			if units != tc.units || known != tc.known || (next == nil) != (tc.next == nil) || (next != nil && *next != *tc.next) {
				t.Errorf("Toward = %d, %v, %v, want %d, %v, %v", units, next, known, tc.units, tc.next, tc.known)
			}
		})
	}
}

func TestCatalogTierRank(t *testing.T) {
	catalog := mustCatalog(t)
	for _, tc := range []struct {
		achievement, tier string
		rank              int
		ok                bool
	}{
		{"dash-builder", "bronze", 0, true},
		{"dash-builder", "gold", 2, true},
		{"dash-builder", "platinum", 0, false},
		{"retired", "bronze", 0, false},
	} {
		if rank, ok := catalog.TierRank(tc.achievement, tc.tier); ok != tc.ok || (ok && rank != tc.rank) {
			t.Errorf("%s/%s = %d, %v, want %d, %v", tc.achievement, tc.tier, rank, ok, tc.rank, tc.ok)
		}
	}
}
