package achievements

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"
)

const (
	maxEventIDBytes       = 64
	eventMaxBackdate      = 30 * 24 * time.Hour
	eventMaxClockSkew     = 5 * time.Minute
	maxContextStringBytes = 1024
)

// ErrInvalidEvent marks an event the route answers with a 400 and the client drops.
var ErrInvalidEvent = errors.New("achievements: invalid event")

// EventRequest is the decoded body of a posted event (RFC §6.1). It has no
// identity fields: identity comes from the authenticated caller.
type EventRequest struct {
	SchemaVersion int            `json:"schemaVersion"`
	EventID       string         `json:"eventId"`
	Entity        string         `json:"entity"`
	Action        string         `json:"action"`
	OccurredAt    string         `json:"occurredAt"`
	Context       map[string]any `json:"context"`
}

// NewEvent checks req against the registry and the clock and returns the event.
// Every failure wraps ErrInvalidEvent.
func (r *Registry) NewEvent(req EventRequest, now time.Time) (Event, error) {
	fail := func(format string, args ...any) (Event, error) {
		return Event{}, fmt.Errorf("%w: %s", ErrInvalidEvent, fmt.Sprintf(format, args...))
	}
	if req.SchemaVersion != SchemaVersion {
		return fail("schemaVersion %d is not supported", req.SchemaVersion)
	}
	if req.EventID == "" || len(req.EventID) > maxEventIDBytes || !printable(req.EventID) {
		return fail("eventId must be 1 to %d printable bytes", maxEventIDBytes)
	}
	declared, ok := r.action(req.Entity, req.Action)
	if !ok {
		return fail("%s.%s is not a declared pair", req.Entity, req.Action)
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, req.OccurredAt)
	if err != nil {
		return fail("occurredAt is not an RFC 3339 timestamp")
	}
	if occurredAt.After(now.Add(eventMaxClockSkew)) || occurredAt.Before(now.Add(-eventMaxBackdate)) {
		return fail("occurredAt is outside the accepted window")
	}
	if len(req.Context) > maxContextFields {
		return fail("context has %d fields, at most %d", len(req.Context), maxContextFields)
	}
	for _, name := range sortedKeys(req.Context) {
		field, ok := declared.Context[name]
		if !ok {
			return fail("context field %q is not declared", name)
		}
		value := req.Context[name]
		if !field.Type.accepts(value) {
			return fail("context field %q is not a %s", name, field.Type)
		}
		if s, isString := value.(string); isString && (len(s) > maxContextStringBytes || !utf8.ValidString(s)) {
			return fail("context field %q is too long or not UTF-8", name)
		}
		if len(field.Enum) > 0 && !inList(field.Enum, value) {
			return fail("context field %q is outside its enum", name)
		}
	}
	return Event{ID: req.EventID, Entity: req.Entity, Action: req.Action, OccurredAt: occurredAt.UTC(), Context: req.Context}, nil
}

func printable(s string) bool {
	if !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// NextAt reports the next tier threshold for a stored tier of one achievement.
// counted is false when the achievement is not in the catalog or is a milestone,
// which have no progress to show.
func (c *Catalog) NextAt(achievementID string, tier int) (next *int, counted bool) {
	for i := range c.Achievements {
		d := &c.Achievements[i]
		if d.ID == achievementID {
			return d.nextThreshold(tier), d.Counter != nil
		}
	}
	return nil, false
}

// Rows is one person's stored state, as read for the /my route.
type Rows struct {
	Awards   []Award
	Progress []Progress
	// AsOf is when the rows were read, which a caching reader keeps from its fill.
	AsOf time.Time
	// Truncated is true when the reader stopped at its record cap.
	Truncated bool
}

// Reader is the read port behind the /my route. Implementations list as the
// caller and return only the person's own rows.
type Reader interface {
	ListMine(ctx context.Context, person Person) (Rows, error)
}
