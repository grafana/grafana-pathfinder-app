package services

import (
	"testing"
	"time"
)

func TestLearningInsightsHistoricalJourneyDoesNotWarnForCurrentCompletions(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	resp := NewLearningInsightsResponse(from, to)
	records := []CompletionRecord{{UserID: "user:1", GuideID: "journey", GuideSource: "bundled", GuideCategory: "learning-journey", CompletedAt: "2026-08-02T00:00:00Z", CompletionPercent: 100}}
	ShapeLearningInsights(&resp, records, nil, from, to, to, true, func(Assignment, []CompletionRecord) ([]AssignmentGuideEntry, error) { return nil, nil })
	if resp.Completeness != "complete" || len(resp.Warnings) != 0 || len(resp.Completions) != 0 {
		t.Fatalf("historical ambiguity contaminated current report: %+v", resp)
	}
}
