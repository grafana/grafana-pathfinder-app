package plugin

import (
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestLearningInsightsSeparatesJourneyEvidence(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	records := []completionRecordSpec{
		{UserID: "user:1", GuideID: "path", GuideSource: "bundled", GuideCategory: "learning-journey", PathID: "path", CompletedAt: "2026-09-02T00:00:00Z", CompletionPercent: 100},
		{UserID: "user:1", GuideID: "milestone", GuideSource: "bundled", GuideCategory: "learning-journey", PathID: "path", CompletedAt: "2026-09-02T00:00:00Z", CompletionPercent: 100},
		{UserID: "user:2", GuideID: "ambiguous", GuideSource: "bundled", GuideCategory: "learning-journey", CompletedAt: "2026-09-02T00:00:00Z", CompletionPercent: 100},
	}
	asg := assignmentSpec{Name: "missing", UserID: "user:2", TargetType: assignmentTargetGuide, TargetID: "ambiguous", TargetSource: "bundled", Lifecycle: assignmentLifecycleActive}
	ev := &obligationEvaluator{logger: log.New()}
	resp := newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, []assignmentSpec{asg}, from, to, to, true, ev.guideProgress)
	if len(resp.Completions) != 1 || resp.Completions[0].GuideID != "milestone" {
		t.Fatalf("mixed guide/path totals: %+v", resp.Completions)
	}
	if resp.Completeness != "partial" || resp.Assignments[0].Status != "unknown" {
		t.Fatalf("ambiguous evidence: %+v", resp)
	}
	if len(resp.People) != 2 {
		t.Fatal("excluded evidence dropped its subject")
	}
}

func TestLearningInsightsEvaluatesOlderQualifiedHistory(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	ev := &obligationEvaluator{logger: log.New()}
	asg := assignmentSpec{Name: "a", UserID: "user:1", TargetType: assignmentTargetGuide, TargetID: "same", TargetSource: "bundled", Lifecycle: assignmentLifecycleActive, AcceptCompletionsFrom: "2026-07-01T00:00:00Z"}
	records := []completionRecordSpec{{UserID: "user:1", GuideID: "same", GuideSource: "bundled", CompletedAt: "2026-08-01T00:00:00Z", CompletionPercent: 100}}
	resp := newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, []assignmentSpec{asg}, from, to, to, true, ev.guideProgress)
	if len(resp.Completions) != 0 || resp.Assignments[0].Status != "complete" {
		t.Fatalf("old accepted evidence: %+v", resp)
	}
	records[0].GuideSource = "app-platform"
	resp = newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, []assignmentSpec{asg}, from, to, to, true, ev.guideProgress)
	if resp.Assignments[0].Status != "outstanding" {
		t.Fatal("source collision credited")
	}
	asg.AcceptCompletionsFrom = "2026-09-01T00:00:00Z"
	records[0].GuideSource = "bundled"
	resp = newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, []assignmentSpec{asg}, from, to, to, true, ev.guideProgress)
	if resp.Assignments[0].Status != "outstanding" {
		t.Fatal("pre-cutoff evidence credited")
	}
}
