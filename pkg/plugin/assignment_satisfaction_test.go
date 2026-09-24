package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
)

func TestObligationMet_GuideAndPath(t *testing.T) {
	ev := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, cloud: false, guidesOK: true}
	welcome := rec("user:1", "bundled", "welcome-to-grafana", "Welcome", "interactive", "getting-started", "objectives", "2026-09-14T15:00:00Z", 100)
	first := rec("user:1", "bundled", "first-dashboard", "First", "interactive", "getting-started", "objectives", "2026-09-16T15:00:00Z", 100)
	prom := rec("user:1", "bundled", "prometheus-grafana-101", "Prom", "interactive", "getting-started", "objectives", "2026-09-15T15:00:00Z", 100)

	logger := newCapturingLogger()
	ev.logger = logger
	guide := assignmentSpec{TargetType: "guide", TargetID: "welcome-to-grafana", TargetSource: "bundled"}
	if ev.met(guide, []completionRecordSpec{welcome}) {
		t.Error("a guide target is not evaluated")
	}
	if !logger.erroredWith("assignment guide target is not evaluated") {
		t.Error("a guide target should log and still return unmet")
	}

	alerting := assignmentSpec{TargetType: "path", TargetID: "alerting-basics"}
	started := assignmentSpec{TargetType: "path", TargetID: "getting-started"}
	partial := []completionRecordSpec{welcome, first}
	if !ev.met(alerting, partial) {
		t.Error("alerting-basics is welcome + first-dashboard")
	}
	if ev.met(started, partial) {
		t.Error("getting-started still needs prometheus-grafana-101")
	}
	if !ev.met(started, []completionRecordSpec{welcome, first, prom}) {
		t.Error("getting-started should be met once every guide has a completion")
	}

	tracked := started
	tracked.TrackID = "seller-track"
	if ev.met(tracked, []completionRecordSpec{welcome, first, prom}) {
		t.Error("a track-qualified path is not evaluated without a track manifest")
	}
	if ev.met(assignmentSpec{TargetType: "course", TargetID: "getting-started"}, partial) {
		t.Error("an unknown target type is not evaluated")
	}
}

func TestObligationMet_AcceptCompletionsFrom(t *testing.T) {
	ev := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, cloud: false}
	early := rec("user:1", "bundled", "prometheus-advanced-queries", "Prom", "interactive", "", "objectives", "2024-12-01T15:00:00Z", 100)
	late := rec("user:1", "bundled", "prometheus-advanced-queries", "Prom", "interactive", "", "objectives", "2026-06-01T15:00:00Z", 40)
	asg := assignmentSpec{
		TargetType:            "path",
		TargetID:              "linux-monitoring",
		AcceptCompletionsFrom: "2026-01-01T00:00:00Z",
		DueAt:                 "2026-03-01T00:00:00Z",
	}
	if ev.met(asg, []completionRecordSpec{early}) {
		t.Error("a completion before acceptCompletionsFrom does not count")
	}
	if !ev.met(asg, []completionRecordSpec{early, late}) {
		t.Error("a later completion counts, including one after dueAt and under 100 percent")
	}
	asg.AcceptCompletionsFrom = "not-a-time"
	if ev.met(asg, []completionRecordSpec{late}) {
		t.Error("an unparseable acceptCompletionsFrom does not evaluate as met")
	}
}

func TestPathGuides_URLAndPrivateCatalogue(t *testing.T) {
	prev := pathIndexFetch
	pathIndexFetch = func(context.Context, string) ([]guideRef, error) {
		return []guideRef{{ID: "select-platform"}}, nil
	}
	t.Cleanup(func() { pathIndexFetch = prev })

	ev := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, cloud: false, guidesOK: true}
	res := ev.guidesFor(assignmentSpec{TargetType: "path", TargetID: "github-visualize"})
	if !res.resolved || len(res.guides) != 1 || res.guides[0].ID != "select-platform" {
		t.Fatalf("url path = %+v", res)
	}

	ev.guides = []customGuideRepositoryEntry{
		{ID: "private-path", Status: "published", Manifest: &customGuideManifest{Type: "path", Milestones: []string{"step-a", "draft-step"}}},
		{ID: "step-a", Status: "published"},
		{ID: "draft-step", Status: "draft"},
	}
	ev.guidesOK = true
	res = ev.guidesFor(assignmentSpec{TargetType: "path", TargetID: "private-path"})
	if !res.resolved || len(res.guides) != 1 || res.guides[0].ID != "step-a" {
		t.Fatalf("private path = %+v", res.guides)
	}
}

func TestParsePathIndexSkipsCover(t *testing.T) {
	body := []byte(`[
		{"relpermalink":"/docs/learning-paths/example/","params":{"grafana":{"skip":true}}},
		{"relpermalink":"/docs/learning-paths/example/select-platform/"}
	]`)
	refs, err := parsePathIndex(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].ID != "select-platform" {
		t.Fatalf("refs = %+v", refs)
	}
}

func TestUseCloudCatalogue(t *testing.T) {
	if useCloudCatalogue(nil) {
		t.Error("nil config is not Cloud")
	}
	oss := sdkconfig.NewGrafanaCfg(map[string]string{sdkconfig.AppURL: "http://localhost:3000"})
	if useCloudCatalogue(oss) {
		t.Error("localhost is not Cloud")
	}
	cloud := sdkconfig.NewGrafanaCfg(map[string]string{sdkconfig.AppURL: "https://learn.grafana.net"})
	if !useCloudCatalogue(cloud) {
		t.Error("a grafana.net app URL is Cloud")
	}
	forced := sdkconfig.NewGrafanaCfg(map[string]string{
		sdkconfig.AppURL:         "http://localhost:3000",
		"cloudMigrationIsTarget": "true",
	})
	if !useCloudCatalogue(forced) {
		t.Error("an explicit cloudMigrationIsTarget wins over the app URL")
	}
}

func TestMyAssignments_EvaluatesBundledPathFromCompletions(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "alerting-basics", "", "bootcamp", "2026-09-01T00:00:00Z"),
		asg("user:1", "getting-started", "", "onboarding", "2026-09-01T00:00:00Z"),
	))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "welcome-to-grafana", "Welcome", "interactive", "getting-started", "objectives", "2026-09-14T15:00:00Z", 100),
		rec("user:1", "bundled", "first-dashboard", "First", "interactive", "alerting-basics", "objectives", "2026-09-16T15:00:00Z", 100),
	))

	_, resp := doMyAssignments(t, "user:1")
	got := map[string]bool{}
	for _, entry := range resp.Assignments {
		got[entry.TargetID] = entry.Satisfied
	}
	if !got["alerting-basics"] {
		t.Error("alerting-basics should be satisfied")
	}
	if got["getting-started"] {
		t.Error("getting-started is missing prometheus-grafana-101")
	}
}
