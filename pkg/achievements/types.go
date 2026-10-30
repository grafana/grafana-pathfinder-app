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

// Progress is one person's stored state for one achievement.
type Progress struct {
	AchievementID string
	// Tier is the highest awarded tier, 0 for none.
	Tier int
	// Units is the sorted, distinct ledger of counted units.
	Units         []string
	Revision      int
	SchemaVersion int
	// Version is the store's opaque compare-and-swap token.
	Version string
}

type Award struct {
	AchievementID string
	Tier          int
	Route         string
	Revision      int
	EarnedAt      time.Time
}

// Store is the persistence port. Implementations write as the caller.
type Store interface {
	// LoadProgress returns the rows that exist; a missing row is absent from the map.
	LoadProgress(ctx context.Context, person Person, achievementIDs []string) (map[string]Progress, error)
	// CreateProgress returns ErrExists when the row exists.
	CreateProgress(ctx context.Context, person Person, p Progress) (Progress, error)
	// SaveProgress writes p if its Version is still current, else returns ErrConflict.
	SaveProgress(ctx context.Context, person Person, p Progress) (Progress, error)
	// CreateAward returns ErrExists when the tier was already awarded.
	CreateAward(ctx context.Context, person Person, a Award) error
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
	From          int    `json:"from"`
	To            int    `json:"to"`
	Final         bool   `json:"final"`
	Units         int    `json:"units"`
	// Next is the threshold of the next tier, nil when final or for a milestone.
	Next     *int `json:"next"`
	Revision int  `json:"revision"`
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
