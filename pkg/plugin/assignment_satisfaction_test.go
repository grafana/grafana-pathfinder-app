package plugin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func activeCatalogue(t *testing.T) []bundledPath {
	t.Helper()
	paths, err := loadLocalCatalogue()
	if ossPathShim != nil {
		paths, err = ossPathShim()
	}
	if err != nil {
		t.Fatal(err)
	}
	return paths
}

func pathWithGuides(t *testing.T) bundledPath {
	t.Helper()
	var found bundledPath
	for _, path := range activeCatalogue(t) {
		if len(path.Guides) > len(found.Guides) {
			found = path
		}
	}
	if len(found.Guides) == 0 {
		t.Fatal("catalogue has no path with inline guides")
	}
	return found
}

func completionsFor(path bundledPath, when string) []completionRecordSpec {
	out := make([]completionRecordSpec, len(path.Guides))
	for i, id := range path.Guides {
		out[i] = rec("user:1", "bundled", id, id, "interactive", path.ID, "objectives", when, 100)
	}
	return out
}

func TestObligationMet_GuideAndPath(t *testing.T) {
	ev := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, guidesOK: true}
	path := pathWithGuides(t)
	done := completionsFor(path, "2026-09-14T15:00:00Z")

	logger := newCapturingLogger()
	ev.logger = logger
	guide := assignmentSpec{TargetType: "guide", TargetID: path.Guides[0], TargetSource: "bundled"}
	if ev.met(guide, done[:1]) {
		t.Error("a guide target is not evaluated")
	}
	if !logger.erroredWith("assignment guide target is not evaluated") {
		t.Error("a guide target should log and still return unmet")
	}

	asg := assignmentSpec{TargetType: "path", TargetID: path.ID}
	if ev.met(asg, done[:len(done)-1]) {
		t.Error("a path is unmet until every guide has a completion")
	}
	if !ev.met(asg, done) {
		t.Error("a path is met once every guide has a completion")
	}

	tracked := asg
	tracked.TrackID = "seller-track"
	if ev.met(tracked, done) {
		t.Error("a track-qualified path is not evaluated without a track manifest")
	}
	if ev.met(assignmentSpec{TargetType: "course", TargetID: path.ID}, done) {
		t.Error("an unknown target type is not evaluated")
	}
}

func TestObligationMet_AcceptCompletionsFrom(t *testing.T) {
	ev := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger}
	var path bundledPath
	for _, candidate := range activeCatalogue(t) {
		if len(candidate.Guides) == 1 {
			path = candidate
			break
		}
	}
	if len(path.Guides) != 1 {
		t.Fatal("catalogue has no single-guide path")
	}
	guideID := path.Guides[0]
	early := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", "2024-12-01T15:00:00Z", 100)
	late := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", "2026-06-01T15:00:00Z", 40)
	asg := assignmentSpec{
		TargetType:            "path",
		TargetID:              path.ID,
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
	pathIndexFetch = func(context.Context, string) ([]string, error) {
		return []string{"select-platform"}, nil
	}
	t.Cleanup(func() { pathIndexFetch = prev })

	urlEv := &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, guidesOK: true}
	res := urlEv.assignmentGuides(assignmentSpec{TargetType: "path", TargetID: "github-visualize"})
	if !res.resolved || len(res.guides) != 1 || res.guides[0] != "select-platform" {
		t.Fatalf("url path = %+v", res)
	}

	// A fresh evaluator: e.guides is set once at construction
	// (newObligationEvaluator), never mutated after a path has already been
	// resolved and memoized on this evaluator.
	ev := &obligationEvaluator{
		ctx:    context.Background(),
		logger: log.DefaultLogger,
		guides: []customGuideRepositoryEntry{
			{ID: "private-path", Status: "published", Manifest: &customGuideManifest{Type: "path", Milestones: []string{"step-a", "draft-step"}}},
			{ID: "step-a", Status: "published"},
			{ID: "draft-step", Status: "draft"},
		},
		guidesOK: true,
	}
	res = ev.assignmentGuides(assignmentSpec{TargetType: "path", TargetID: "private-path"})
	if !res.resolved || len(res.guides) != 1 || res.guides[0] != "step-a" {
		t.Fatalf("private path = %+v", res.guides)
	}
}

func TestResolveGuidesFromPathIndex_SkipsCover(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[
			{"relpermalink":"/docs/learning-paths/example/","params":{"grafana":{"skip":true}}},
			{"relpermalink":"/docs/learning-paths/example/select-platform/"}
		]`))
	}))
	defer srv.Close()

	prevClient := pathIndexClient
	pathIndexClient = srv.Client()
	t.Cleanup(func() { pathIndexClient = prevClient })

	ids, err := resolveGuidesFromPathIndex(context.Background(), srv.URL+"/docs/learning-paths/example/")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "select-platform" {
		t.Fatalf("ids = %+v", ids)
	}
}

// A private App Platform path is the third source learning-paths.hook.ts
// merges, and on Cloud it is where a path with its own members lives.
func TestMyAssignments_EvaluatesAppPlatformPathFromCompletions(t *testing.T) {
	path := guideEntry("fe-alerting-path", "Alerting enablement", "published", "path")
	path.Manifest.Milestones = []string{"fe-alerting-01", "fe-alerting-draft"}
	withGuideLister(t, singlePageGuideLister(
		path,
		guideEntry("fe-alerting-01", "Module 1", "published", "guide"),
		guideEntry("fe-alerting-draft", "Module 2", "draft", "guide"),
	))
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "fe-alerting-path", "", "onboarding", "2026-09-01T00:00:00Z"),
	))
	withLister(t, singlePageLister(
		rec("user:1", "app-platform", "fe-alerting-01", "Module 1", "interactive", "fe-alerting-path", "objectives", "2026-09-14T15:00:00Z", 100),
	))

	_, resp := doMyAssignments(t, "user:1")
	if len(resp.Assignments) != 1 {
		t.Fatalf("assignments = %+v", resp.Assignments)
	}
	if !resp.Assignments[0].Satisfied {
		t.Error("a published member completion satisfies the path; a draft member is not required")
	}
}

func TestMyAssignments_EvaluatesBundledPathFromCompletions(t *testing.T) {
	path := pathWithGuides(t)
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", path.ID, "", "bootcamp", "2026-09-01T00:00:00Z"),
		asg("user:1", "not-a-bundled-path", "", "onboarding", "2026-09-01T00:00:00Z"),
	))
	withLister(t, singlePageLister(completionsFor(path, "2026-09-14T15:00:00Z")...))

	_, resp := doMyAssignments(t, "user:1")
	got := map[string]bool{}
	for _, entry := range resp.Assignments {
		got[entry.TargetID] = entry.Satisfied
	}
	if !got[path.ID] {
		t.Errorf("%s should be satisfied", path.ID)
	}
	if got["not-a-bundled-path"] {
		t.Error("an unknown path stays unmet")
	}
}
