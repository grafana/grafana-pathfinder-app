package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type AssignmentViewDependencies struct {
	ReadCompletions func(context.Context, string) ([]CompletionRecord, error)
	Progress        func(Assignment, []CompletionRecord) ([]AssignmentGuideEntry, error)
	MarkSatisfied   func([]Assignment)
	Logger          log.Logger
}

func ReadAssignmentView(ctx context.Context, records []Assignment, userID string, deps AssignmentViewDependencies) ([]AssignmentEntry, error) {
	if len(records) == 0 {
		return []AssignmentEntry{}, nil
	}
	completions, err := deps.ReadCompletions(ctx, userID)
	if err != nil {
		return nil, err
	}
	var unmarked []Assignment
	entries := ShapeAssignments(deps.Logger, records, func(rec Assignment) ([]AssignmentGuideEntry, error) {
		guides, err := deps.Progress(rec, completions)
		if err != nil {
			deps.Logger.Info("assignment guides unavailable", "targetId", rec.TargetID, "trackId", rec.TrackID, "error", err)
			return nil, err
		}
		if rec.Name != "" && (rec.StatusSatisfied == nil || !*rec.StatusSatisfied) && SatisfiedFromGuides(guides) {
			unmarked = append(unmarked, rec)
		}
		return guides, nil
	})
	deps.MarkSatisfied(unmarked)
	return entries, nil
}
