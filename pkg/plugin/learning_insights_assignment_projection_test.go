package plugin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestLearningInsightsRecorderHistoryMatchesLearner(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	for _, pathID := range []string{"", "member"} {
		for _, at := range []string{"2026-08-02T00:00:00Z", "2026-09-02T00:00:00Z"} {
			for _, source := range []string{"online-cdn", "interactive-tutorials", "bundled", "app-platform", "arbitrary", ""} {
				for _, cutoff := range []string{at, "2026-09-03T00:00:00Z"} {
					t.Run(pathID+"/"+at+"/"+source+"/"+cutoff, func(t *testing.T) {
						rows := []completionRecordSpec{{UserID: "user:1", GuideID: "member", GuideSource: source, GuideCategory: "learning-journey", PathID: pathID, CompletionPercent: 100, CompletedAt: at, Source: "objectives"}}
						sourceFn := func(context.Context, string, string, string) ([]assignmentGuideIdentity, bool, error) {
							return []assignmentGuideIdentity{onlineAssignmentGuide("member")}, true, nil
						}
						for _, targetType := range []string{assignmentTargetGuide, assignmentTargetPath} {
							asg := assignmentSpec{Name: "assigned", UserID: "user:1", TargetType: targetType, TargetID: "member", TargetSource: "online-cdn", Lifecycle: assignmentLifecycleActive, DueAt: "2026-09-01T00:00:00Z", AcceptCompletionsFrom: cutoff}
							ev := newTestEvaluator(sourceFn)
							learner := mustGuideProgress(t, ev, asg, rows)
							for _, complete := range []bool{true, false} {
								unrelated := asg
								unrelated.Name, unrelated.UserID = "unrelated", "user:2"
								resp := newLearningInsightsResponse(from, to)
								shapeLearningInsights(&resp, rows, []assignmentSpec{asg, unrelated}, from, to, to, complete, ev.guideProgress)
								if len(resp.Completions) != 0 || len(resp.People) != 2 {
									t.Fatalf("chart ambiguity or subjects: %+v", resp)
								}
								for _, got := range resp.Assignments {
									want := "overdue"
									if got.UserID == "user:1" && satisfiedFromGuides(learner) {
										want = "complete"
									} else if !complete || source == "" {
										want = "unknown"
									}
									if got.Status != want {
										t.Fatalf("%s/%s historyComplete=%v: got %+v, learner %+v, want %s", targetType, source, complete, got, learner, want)
									}
									if got.UserID == "user:1" && satisfiedFromGuides(got.Guides) != satisfiedFromGuides(learner) {
										t.Fatalf("credit parity: %+v vs %+v", got.Guides, learner)
									}
								}
							}
						}
					})
				}
			}
		}
	}
}

func TestOnlinePathGuidesRejectsOtherSourcesBeforeFetch(t *testing.T) {
	calls := 0
	withFetcherOverride(t, func(context.Context, string, int64) ([]byte, error) {
		calls++
		return nil, errors.New("fetch unavailable")
	})
	app := newTestApp(t)
	r := insightsRequest(t, "Admin", "user:1")
	insightsSource := app.insightsObligationEvaluator(r).sources[2]
	resp := &PackageRecommendationsResponse{BaseURL: "https://interactive-learning.grafana.net/packages/", Packages: []PackageEntry{{ID: "path", Path: "paths/path"}}}
	for _, source := range []string{"bundled", "app-platform", "arbitrary"} {
		guides, found, err := app.resolveOnlinePathGuides(context.Background(), resp, log.DefaultLogger, "path", "", source)
		if err != nil || found || guides != nil {
			t.Fatalf("source %q: %+v, %v, %v", source, guides, found, err)
		}
		guides, found, err = app.onlinePathGuides(log.DefaultLogger)(context.Background(), "path", "", source)
		if err != nil || found || guides != nil {
			t.Fatalf("source chain %q: %+v, %v, %v", source, guides, found, err)
		}
		guides, found, err = insightsSource(r.Context(), "path", "", source)
		if err != nil || found || guides != nil {
			t.Fatalf("insights source chain %q: %+v, %v, %v", source, guides, found, err)
		}
	}
	if calls != 0 {
		t.Fatalf("non-online targets fetched %d times", calls)
	}
	_, found, err := app.resolveOnlinePathGuides(context.Background(), resp, log.DefaultLogger, "path", "", "online-cdn")
	if calls != 1 || !found || err == nil {
		t.Fatalf("online target did not exercise failing manifest fetch: calls=%d, found=%v, error=%v", calls, found, err)
	}
}
