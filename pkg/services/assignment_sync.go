package services

import "github.com/grafana/grafana-plugin-sdk-go/backend/log"

func ContainsAssignmentGuide(guides []AssignmentGuideIdentity, record CompletionRecord) bool {
	for _, guide := range guides {
		if AssignmentGuideMatchesCompletion(guide, record) {
			return true
		}
	}
	return false
}
func SyncSatisfiedAssignments(records []Assignment, just CompletionRecord, ev *ObligationEvaluator, readCompletions func() ([]CompletionRecord, error), mark func(Assignment), logger log.Logger) {
	var candidates []Assignment
	for _, rec := range records {
		if rec.Name == "" || (rec.StatusSatisfied != nil && *rec.StatusSatisfied) {
			continue
		}
		guideIDs, err := ev.AssignmentGuides(rec)
		if err != nil {
			logger.Info("assignment status write skipped", "targetId", rec.TargetID, "error", err)
			continue
		}
		if ContainsAssignmentGuide(guideIDs, just) {
			candidates = append(candidates, rec)
		}
	}
	if len(candidates) == 0 {
		return
	}
	completions, err := readCompletions()
	if err != nil {
		logger.Info("assignment status write skipped", "error", err)
		return
	}
	fresh := true
	for _, rec := range completions {
		if rec.GuideID == just.GuideID && rec.GuideSource == just.GuideSource && rec.CompletedAt == just.CompletedAt {
			fresh = false
			break
		}
	}
	if fresh {
		completions = append(completions, just)
	}
	for _, rec := range candidates {
		guides, err := ev.GuideProgress(rec, completions)
		if err != nil || !SatisfiedFromGuides(guides) {
			continue
		}
		mark(rec)
	}
}
