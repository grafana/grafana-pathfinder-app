package services

import (
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"sort"
)

type AssignmentEntry struct {
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TrackID      string `json:"trackId,omitempty"`
	TargetSource string `json:"targetSource,omitempty"`

	RuleID     string `json:"ruleId,omitempty"`
	AssignedBy string `json:"assignedBy,omitempty"`
	AssignedAt string `json:"assignedAt,omitempty"`

	DueAt                 string `json:"dueAt,omitempty"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom,omitempty"`

	Satisfied bool `json:"satisfied"`
	// Guides is absent when the target could not be resolved.
	Guides    []AssignmentGuideEntry `json:"guides,omitempty"`
	Lifecycle string                 `json:"lifecycle"`
}

type AssignmentGuideEntry struct {
	GuideID     string `json:"guideId"`
	GuideSource string `json:"guideSource"`
	Completed   bool   `json:"completed"`
}

// Empty or unresolved membership cannot prove satisfaction.
func SatisfiedFromGuides(guides []AssignmentGuideEntry) bool {
	if len(guides) == 0 {
		return false
	}
	for _, g := range guides {
		if !g.Completed {
			return false
		}
	}
	return true
}

func ShapeAssignments(logger log.Logger, records []Assignment, progress func(Assignment) ([]AssignmentGuideEntry, error)) []AssignmentEntry {
	entries := []AssignmentEntry{}
	for _, rec := range records {
		guides, err := progress(rec)
		if err != nil {
			logger.Info("assignment omitted, progress unavailable", "targetId", rec.TargetID, "ruleId", rec.RuleID, "error", err)
			continue
		}
		entries = append(entries, AssignmentEntry{
			TargetType:            rec.TargetType,
			TargetID:              rec.TargetID,
			TrackID:               rec.TrackID,
			TargetSource:          rec.TargetSource,
			RuleID:                rec.RuleID,
			AssignedBy:            rec.AssignedBy,
			AssignedAt:            rec.AssignedAt,
			DueAt:                 rec.DueAt,
			AcceptCompletionsFrom: rec.AcceptCompletionsFrom,
			Satisfied:             SatisfiedFromGuides(guides),
			Guides:                guides,
			Lifecycle:             rec.Lifecycle,
		})
	}
	SortAssignments(entries)
	return entries
}

// SortAssignments orders entries by assignedAt descending, so the newest
// obligation leads. Parseable timestamps sort chronologically; unparseable and
// absent ones sort last, then by (targetType, targetId, trackId, ruleId) so
// the order is total and a golden cannot flake on map iteration or upstream
// page order.
func SortAssignments(entries []AssignmentEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		x, y := entries[i], entries[j]
		tx, okx := ParseCompletionTime(x.AssignedAt)
		ty, oky := ParseCompletionTime(y.AssignedAt)
		if okx && oky && !tx.Equal(ty) {
			return tx.After(ty)
		}
		if okx != oky {
			return okx // the one that parsed leads
		}
		if x.TargetType != y.TargetType {
			return x.TargetType < y.TargetType
		}
		if x.TargetID != y.TargetID {
			return x.TargetID < y.TargetID
		}
		if x.TrackID != y.TrackID {
			return x.TrackID < y.TrackID
		}
		return x.RuleID < y.RuleID
	})
}
