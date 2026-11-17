package achievements

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrExists is a Store's answer to a create whose object already exists (409).
	ErrExists = errors.New("achievements: already exists")
	// ErrConflict is a Store's answer to a save at a stale Version.
	ErrConflict = errors.New("achievements: version conflict")
)

// Person is an authenticated person. Identity never comes from an event body.
type Person struct {
	ID string
}

// Event is one posted event (RFC §6.1), already validated against the registry.
type Event struct {
	ID         string
	Entity     string
	Action     string
	OccurredAt time.Time
	Context    map[string]any
}

// SchemaVersion versions a posted event and a stored award row, not the grammar.
const SchemaVersion = 1

// ProgressSchemaVersion versions the stored progress row's shape. Version 2
// rows hold points and unit-named ledger keys, so builds that wrote version 1
// leave them alone as record_newer. A version 1 row read here keeps its held
// tiers, starts at 0 points, and its old ledger keys never match a new one.
const ProgressSchemaVersion = 2

// Progress is one person's stored state for one achievement.
type Progress struct {
	AchievementID string
	// TierIDs is the set of tier ids held, including ids a newer catalog defined.
	TierIDs []string
	// Units is the achievement-wide ledger of counted units, so a unit counts
	// toward one tier only. Each is the unit name, ":", then its id fields (the
	// event id for an occurrence), each as byte length, ":" and the field
	// ("guide:7:bundled4:tour"). Stores must return Units sorted ascending and
	// distinct, which the evaluator binary-searches.
	Units []string
	// Points is earned toward the lowest tier TierIDs does not hold, and resets
	// to 0 when that tier is earned.
	Points        int
	SchemaVersion int
	// Version is the store's opaque compare-and-swap token.
	Version string
}

type Award struct {
	AchievementID string
	TierID        string
	Entity        string
	EarnedAt      time.Time
}

// Store is the persistence port. Implementations write as the caller.
type Store interface {
	// LoadProgress returns the rows that exist; a missing row is absent from the
	// map. Each row's Units must be sorted ascending and distinct.
	LoadProgress(ctx context.Context, person Person, achievementIDs []string) (map[string]Progress, error)
	// CreateProgress returns ErrExists when the row exists.
	CreateProgress(ctx context.Context, person Person, p Progress) (Progress, error)
	// SaveProgress writes p if its Version is still current, else returns ErrConflict.
	SaveProgress(ctx context.Context, person Person, p Progress) (Progress, error)
	// CreateAward returns ErrExists when the tier was already awarded.
	CreateAward(ctx context.Context, person Person, a Award) error
	// HasAward reports whether the tier's award row exists.
	HasAward(ctx context.Context, person Person, achievementID, tierID string) (bool, error)
}

// Policy is the admission port: people only, with a per-user rate limit. A
// refusal is returned by Evaluate as an error and is never a decision.
type Policy interface {
	Allow(ctx context.Context, person Person) error
}

type Kind string

const (
	KindAward     Kind = "award"
	KindTierUp    Kind = "tier_up"
	KindIncrement Kind = "increment"
	KindIgnored   Kind = "ignored"
)

type Reason string

const (
	ReasonDuplicate        Reason = "duplicate"
	ReasonComplete         Reason = "complete"
	ReasonConditionNotMet  Reason = "condition_not_met"
	ReasonInvalidContext   Reason = "invalid_context"
	ReasonConflict         Reason = "conflict"
	ReasonRecordNewer      Reason = "record_newer"
	ReasonStoreUnavailable Reason = "store_unavailable"
)

func (r Reason) Transient() bool {
	switch r {
	case ReasonConflict, ReasonRecordNewer, ReasonStoreUnavailable:
		return true
	case ReasonDuplicate, ReasonComplete, ReasonConditionNotMet, ReasonInvalidContext:
		return false
	default:
		return false
	}
}

// Decision is the advisory outcome for one achievement (RFC §6.3, §6.5).
type Decision struct {
	AchievementID string `json:"achievementId"`
	Decision      Kind   `json:"decision"`
	Reason        Reason `json:"reason,omitempty"`
	// Awarded lists the tier ids this event added to the held set, in catalog order.
	Awarded []string `json:"awarded"`
	// Final reports that every tier in the catalog is held.
	Final bool `json:"final"`
	// Units is the points earned toward the lowest tier not held, 0 when Final.
	Units int `json:"units"`
	// Next is that tier's goal, nil when Final.
	Next *int `json:"next"`
}

// Retry reports whether any decision has a transient reason, so the event stays queued.
func Retry(decisions []Decision) bool {
	for _, d := range decisions {
		if d.Reason.Transient() {
			return true
		}
	}
	return false
}
