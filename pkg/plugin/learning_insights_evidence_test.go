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

func TestLearningInsightsRecorderRowsPreserveUnrelatedHistory(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	for _, pathID := range []string{"", "journey"} {
		t.Run("journey-path-"+pathID, func(t *testing.T) {
			// markMilestoneDone emits no pathId; recordJourneyCompletion may use the journey's own id.
			records := []completionRecordSpec{
				{UserID: "user:1", GuideID: "milestone", GuideSource: "bundled", GuideCategory: "learning-journey", CompletedAt: "2026-09-02T00:00:00Z", CompletionPercent: 100, Source: "objectives"},
				{UserID: "user:1", GuideID: "journey", GuideSource: "bundled", GuideCategory: "learning-journey", PathID: pathID, CompletedAt: "2026-09-02T00:00:00Z", CompletionPercent: 100, Source: "objectives"},
				{UserID: "user:1", GuideID: "guide", GuideSource: "bundled", GuideCategory: "interactive", CompletedAt: "2026-08-02T00:00:00Z", CompletionPercent: 100, Source: "objectives"},
			}
			assignment := func(name, userID, guideID, dueAt string) assignmentSpec {
				return assignmentSpec{Name: name, UserID: userID, TargetType: assignmentTargetGuide, TargetID: guideID, TargetSource: "bundled", Lifecycle: assignmentLifecycleActive, DueAt: dueAt, AcceptCompletionsFrom: "2026-08-01T00:00:00Z"}
			}
			assignments := []assignmentSpec{
				assignment("complete", "user:1", "guide", ""),
				assignment("milestone", "user:1", "milestone", ""),
				assignment("journey", "user:1", "journey", ""),
				assignment("outstanding", "user:1", "missing", ""),
				assignment("overdue", "user:2", "missing", "2026-09-01T00:00:00Z"),
			}
			ev := &obligationEvaluator{logger: log.New()}
			for _, historyComplete := range []bool{true, false} {
				resp := newLearningInsightsResponse(from, to)
				shapeLearningInsights(&resp, records, assignments, from, to, to, historyComplete, ev.guideProgress)
				if len(resp.Completions) != 0 || len(resp.People) != 2 {
					t.Fatalf("ambiguous rows credited or subjects lost: %+v", resp)
				}
				if resp.Completeness != "partial" || len(resp.Warnings) != 1 || resp.Warnings[0] != "journey-identity-ambiguous" {
					t.Fatalf("missing row-exclusion warning: %+v", resp)
				}
				for _, got := range resp.Assignments {
					want := "outstanding"
					if got.Name == "complete" {
						want = "complete"
					} else if !historyComplete {
						want = "unknown"
					} else if got.Name == "overdue" {
						want = "overdue"
					}
					if got.Status != want || (want == "unknown" && got.Reason != "completion-history-incomplete") {
						t.Errorf("historyComplete=%v assignment=%s: got %s (%s), want %s", historyComplete, got.Name, got.Status, got.Reason, want)
					}
					if got.Name == "complete" && (len(got.Guides) != 1 || !got.Guides[0].Completed) {
						t.Errorf("older unrelated evidence lost: %+v", got)
					}
				}
			}
		})
	}
}
