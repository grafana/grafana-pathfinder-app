package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func activeCatalogue(t *testing.T) []bundledPath {
	t.Helper()
	paths, err := loadLocalCatalogue()
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

func newTestEvaluator(sources ...pathGuideSource) *obligationEvaluator {
	return &obligationEvaluator{ctx: context.Background(), logger: log.DefaultLogger, sources: sources}
}

func TestGuideProgress_GuideAndPath(t *testing.T) {
	ev := newTestEvaluator(bundledPathGuides)
	path := pathWithGuides(t)
	done := completionsFor(path, "2026-09-14T15:00:00Z")

	guide := assignmentSpec{TargetType: "guide", TargetID: path.Guides[0], TargetSource: "bundled"}
	if satisfiedFromGuides(ev.guideProgress(guide, done[:1])) {
		t.Error("a guide target is not evaluated")
	}

	asg := assignmentSpec{TargetType: "path", TargetID: path.ID}
	if satisfiedFromGuides(ev.guideProgress(asg, done[:len(done)-1])) {
		t.Error("a path is unmet until every guide has a completion")
	}
	if !satisfiedFromGuides(ev.guideProgress(asg, done)) {
		t.Error("a path is met once every guide has a completion")
	}

	tracked := asg
	tracked.TrackID = "seller-track"
	if ev.guideProgress(tracked, done) != nil {
		t.Error("a track-qualified path is not evaluated without a track manifest")
	}
	if ev.guideProgress(assignmentSpec{TargetType: "course", TargetID: path.ID}, done) != nil {
		t.Error("an unknown target type is not evaluated")
	}
}

func TestGuideProgress_AcceptCompletionsFrom(t *testing.T) {
	ev := newTestEvaluator(bundledPathGuides)
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
	met := func(completions ...completionRecordSpec) bool {
		return satisfiedFromGuides(ev.guideProgress(asg, completions))
	}
	if met(early) {
		t.Error("a completion before acceptCompletionsFrom does not count")
	}
	if !met(early, late) {
		t.Error("a later completion counts, including one after dueAt and under 100 percent")
	}
	exact := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", asg.AcceptCompletionsFrom, 100)
	if !met(exact) {
		t.Error("a completion exactly at acceptCompletionsFrom counts as met")
	}
	asg.AcceptCompletionsFrom = "not-a-time"
	if met(late) {
		t.Error("an unparseable acceptCompletionsFrom does not evaluate as met")
	}
}

func TestBundledPathGuides_FallsBackToPathIndex(t *testing.T) {
	prev := pathIndexFetch
	pathIndexFetch = func(context.Context, string) ([]string, error) {
		return []string{"select-platform"}, nil
	}
	t.Cleanup(func() { pathIndexFetch = prev })

	guides, found, err := bundledPathGuides(context.Background(), "linux-server-integration")
	if err != nil || !found || len(guides) != 1 || guides[0] != "select-platform" {
		t.Fatalf("guides = %v, found = %v, err = %v", guides, found, err)
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

func TestMyAssignments_SatisfactionBySource(t *testing.T) {
	twoGuidePath := func(t *testing.T) {
		path := guideEntry("fe-two-guide-path", "Two-guide path", "published", "path")
		path.Manifest.Milestones = []string{"fe-guide-done", "fe-guide-todo"}
		withGuideLister(t, singlePageGuideLister(
			path,
			guideEntry("fe-guide-done", "Module 1", "published", "guide"),
			guideEntry("fe-guide-todo", "Module 2", "published", "guide"),
		))
	}
	cases := []struct {
		name          string
		setup         func(t *testing.T) (targetID string, completions []completionRecordSpec)
		wantSatisfied bool
		wantGuides    map[string]bool
	}{
		{
			name: "bundled path satisfied",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				path := pathWithGuides(t)
				return path.ID, completionsFor(path, "2026-09-14T15:00:00Z")
			},
			wantSatisfied: true,
		},
		{
			name: "unknown path unmet",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				return "not-a-bundled-path", completionsFor(pathWithGuides(t), "2026-09-14T15:00:00Z")
			},
		},
		{
			name: "App Platform path ignores a draft member",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				path := guideEntry("fe-alerting-path", "Alerting enablement", "published", "path")
				path.Manifest.Milestones = []string{"fe-alerting-01", "fe-alerting-draft"}
				withGuideLister(t, singlePageGuideLister(
					path,
					guideEntry("fe-alerting-01", "Module 1", "published", "guide"),
					guideEntry("fe-alerting-draft", "Module 2", "draft", "guide"),
				))
				return "fe-alerting-path", []completionRecordSpec{
					rec("user:1", "app-platform", "fe-alerting-01", "Module 1", "interactive", "fe-alerting-path", "objectives", "2026-09-14T15:00:00Z", 100),
				}
			},
			wantSatisfied: true,
		},
		{
			name: "App Platform path partially done reports per-guide state",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				twoGuidePath(t)
				return "fe-two-guide-path", []completionRecordSpec{
					rec("user:1", "app-platform", "fe-guide-done", "Module 1", "interactive", "fe-two-guide-path", "objectives", "2026-09-14T15:00:00Z", 100),
				}
			},
			wantGuides: map[string]bool{"fe-guide-done": true, "fe-guide-todo": false},
		},
		{
			name: "online catalogue path satisfied",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				withFetcherOverride(t, func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
					switch {
					case strings.HasSuffix(rawURL, "repository.json"):
						return []byte(`{"online-only-path": {"path": "online-only-path/v1", "type": "path"}}`), nil
					case strings.HasSuffix(rawURL, "/online-only-path/v1/manifest.json"):
						return []byte(`{"id": "online-only-path", "milestones": ["online-milestone-1"]}`), nil
					default:
						return nil, fmt.Errorf("unexpected URL %q", rawURL)
					}
				})
				return "online-only-path", []completionRecordSpec{
					rec("user:1", "bundled", "online-milestone-1", "Online milestone", "interactive", "online-only-path", "objectives", "2026-09-14T15:00:00Z", 100),
				}
			},
			wantSatisfied: true,
		},
		{
			name: "no completion list is unmet",
			setup: func(t *testing.T) (string, []completionRecordSpec) {
				return pathWithGuides(t).ID, nil
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resetPackageRecommendationsCache()
			withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
			withFetcherOverride(t, func(context.Context, string, int64) ([]byte, error) {
				return nil, errors.New("package index unavailable")
			})
			target, completions := tc.setup(t)
			withAssignmentLister(t, singlePageAssignmentLister(asg("user:1", target, "", "onboarding", "2026-09-01T00:00:00Z")))
			if completions != nil {
				withLister(t, singlePageLister(completions...))
			}

			_, resp := doMyAssignments(t, "user:1")

			if len(resp.Assignments) != 1 {
				t.Fatalf("assignments = %+v", resp.Assignments)
			}
			entry := resp.Assignments[0]
			if entry.Satisfied != tc.wantSatisfied {
				t.Errorf("satisfied = %v, want %v", entry.Satisfied, tc.wantSatisfied)
			}
			if tc.wantGuides != nil {
				got := map[string]bool{}
				for _, g := range entry.Guides {
					got[g.GuideID] = g.Completed
				}
				if !reflect.DeepEqual(got, tc.wantGuides) {
					t.Errorf("guides = %v, want %v", got, tc.wantGuides)
				}
			}
		})
	}
}

func TestWriteSatisfiedAssignments_RunsInBackgroundAndPatchesNewlySatisfied(t *testing.T) {
	path := pathWithGuides(t)
	target := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
	target.Name = "assignment-1"
	target.ResourceVersion = "42"

	type patchCall struct {
		name            string
		resourceVersion string
		satisfied       bool
	}
	patched := make(chan patchCall, 1)
	lister := singlePageAssignmentLister(target)
	lister.updateStatus = func(_ context.Context, _, name, resourceVersion string, satisfied bool) error {
		patched <- patchCall{name: name, resourceVersion: resourceVersion, satisfied: satisfied}
		return nil
	}
	withAssignmentLister(t, lister)

	// The just-completed guide is the last one missing from the LIST.
	done := completionsFor(path, "2026-09-14T15:00:00Z")
	withLister(t, singlePageLister(done[:len(done)-1]...))

	app := newTestApp(t)
	r := completionRequest(t, "/completion-records", "user:1")

	app.writeSatisfiedAssignments(r, "user:1", done[len(done)-1])

	select {
	case call := <-patched:
		if call.name != "assignment-1" || call.resourceVersion != "42" || !call.satisfied {
			t.Fatalf("UpdateStatus call = %+v, want name=assignment-1 resourceVersion=42 satisfied=true", call)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("writeSatisfiedAssignments did not PATCH the newly satisfied assignment in time")
	}
}

func TestWriteSatisfiedAssignments_RecoversFromPanic(t *testing.T) {
	reached := make(chan struct{})
	lister := singlePageAssignmentLister(asg("user:1", "grafana-fundamentals", "", "onboarding", "2026-09-01T00:00:00Z"))
	lister.respond = func(string) (*assignmentPage, error) {
		defer close(reached)
		panic("synthetic panic for TestWriteSatisfiedAssignments_RecoversFromPanic")
	}
	withAssignmentLister(t, lister)

	app := newTestApp(t)
	r := completionRequest(t, "/completion-records", "user:1")
	just := rec("user:1", "bundled", "g1", "G1", "interactive", "", "objectives", "2026-09-14T15:00:00Z", 100)

	app.writeSatisfiedAssignments(r, "user:1", just)

	select {
	case <-reached:
		// An unrecovered panic here would kill the whole test binary.
	case <-time.After(2 * time.Second):
		t.Fatal("panicking lister was never reached")
	}
}

func TestSyncSatisfiedAssignments_Skips(t *testing.T) {
	path := pathWithGuides(t)
	done := completionsFor(path, "2026-09-14T15:00:00Z")
	yes := true

	cases := []struct {
		name string
		edit func(a *assignmentSpec)
		just completionRecordSpec
	}{
		{name: "already satisfied", edit: func(a *assignmentSpec) { a.StatusSatisfied = &yes }, just: done[0]},
		{name: "just-completed guide is not in the target", just: rec("user:1", "bundled", "unrelated", "Unrelated", "interactive", "", "objectives", "2026-09-14T16:00:00Z", 100)},
		{name: "withdrawn", edit: func(a *assignmentSpec) { a.Lifecycle = "withdrawn" }, just: done[0]},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			target := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
			target.Name = "assignment-1"
			if tc.edit != nil {
				tc.edit(&target)
			}
			var updates int32
			lister := singlePageAssignmentLister(target)
			lister.updateStatus = func(context.Context, string, string, string, bool) error {
				atomic.AddInt32(&updates, 1)
				return nil
			}
			withAssignmentLister(t, lister)
			withLister(t, singlePageLister(done...))

			r := completionRequest(t, "/completion-records", "user:1")
			newTestApp(t).syncSatisfiedAssignments(r, "user:1", tc.just, log.DefaultLogger)

			if n := atomic.LoadInt32(&updates); n != 0 {
				t.Errorf("UpdateStatus calls = %d, want 0", n)
			}
		})
	}
}
