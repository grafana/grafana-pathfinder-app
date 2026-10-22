package plugin

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestMyAssignments_SatisfactionReadHasNoRecordCap(t *testing.T) {
	prevCap := completionListMaxTotalRecords
	completionListMaxTotalRecords = 1
	t.Cleanup(func() { completionListMaxTotalRecords = prevCap })

	path := pathWithGuides(t)
	filler := rec("user:other", "bundled", "filler", "Filler", "interactive", "", "objectives", "2026-09-14T15:00:00Z", 100)
	withAssignmentLister(t, singlePageAssignmentLister(asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")))
	withLister(t, &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		if token == "" {
			return &completionRecordPage{Records: []completionRecordSpec{filler, filler}, Continue: "page-2"}, nil
		}
		return &completionRecordPage{Records: completionsFor(path, "2026-09-14T15:00:00Z")}, nil
	}})

	_, resp := doMyAssignments(t, "user:1")

	if len(resp.Assignments) != 1 || !resp.Assignments[0].Satisfied {
		t.Fatalf("assignments = %+v, want the one past the record cap satisfied", resp.Assignments)
	}
}

func TestMyAssignments_NoAssignmentsSkipsCompletionAndGuideReads(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(asg("user:2", "grafana-fundamentals", "", "onboarding", "2026-09-01T00:00:00Z")))
	completions := singlePageLister()
	withLister(t, completions)
	guides := singlePageGuideLister()
	withGuideLister(t, guides)

	rr, resp := doMyAssignments(t, "user:1")

	if rr.Code != http.StatusOK || !resp.Capability.Available || len(resp.Assignments) != 0 {
		t.Fatalf("status = %d, response = %+v, want an available empty list", rr.Code, resp)
	}
	if n := completions.callCount(); n != 0 {
		t.Errorf("completion LIST calls = %d, want 0", n)
	}
	if n := guides.callCount(); n != 0 {
		t.Errorf("custom guide LIST calls = %d, want 0", n)
	}
}

func TestMyAssignments_CustomGuideDrainIsLazy(t *testing.T) {
	path := pathWithGuides(t)
	withAssignmentLister(t, singlePageAssignmentLister(asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")))
	guides := singlePageGuideLister()
	withGuideLister(t, guides)

	doMyAssignments(t, "user:1")

	if n := guides.callCount(); n != 0 {
		t.Errorf("custom guide LIST calls = %d, want 0 for a bundled path", n)
	}
}

func TestSyncSatisfiedAssignments_NoRelevantAssignmentSkipsCompletionRead(t *testing.T) {
	path := pathWithGuides(t)
	target := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
	target.Name = "assignment-1"
	withAssignmentLister(t, singlePageAssignmentLister(target))
	completions := singlePageLister()
	withLister(t, completions)
	just := rec("user:1", "bundled", "unrelated", "Unrelated", "interactive", "", "objectives", "2026-09-14T16:00:00Z", 100)

	newTestApp(t).syncSatisfiedAssignments(completionRequest(t, "/completion-records", "user:1"), "user:1", just, log.DefaultLogger)

	if n := completions.callCount(); n != 0 {
		t.Errorf("completion LIST calls = %d, want 0", n)
	}
}

func TestMyAssignments_ReadRateLimited(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withAssignmentLister(t, singlePageAssignmentLister())
	app := newTestApp(t)
	app.assignmentsReadRateLimiter = newUserRateLimiter(assignmentsReadRateBurst, assignmentsReadRateRefillPerSec)

	for i := 0; i < int(assignmentsReadRateBurst); i++ {
		if rr, _ := doMyAssignmentsWith(t, app, completionRequest(t, "/assignments/my", "user:1")); rr.Code != http.StatusOK {
			t.Fatalf("request %d within burst got %d, want 200", i, rr.Code)
		}
	}
	rr, _ := doMyAssignmentsWith(t, app, completionRequest(t, "/assignments/my", "user:1"))

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("over-budget request got %d, want 429", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("429 must carry a Retry-After hint")
	}
	if rr, _ := doMyAssignmentsWith(t, app, completionRequest(t, "/assignments/my", "user:2")); rr.Code != http.StatusOK {
		t.Errorf("other user got %d, want 200 (limit is per-user)", rr.Code)
	}
}

func withInlineStatusDispatch(t *testing.T) {
	t.Helper()
	prev := assignmentStatusDispatchOverride
	assignmentStatusDispatchOverride = func(run func()) { run() }
	t.Cleanup(func() { assignmentStatusDispatchOverride = prev })
}

func withPathIndexFetch(t *testing.T, fn func(context.Context, string) ([]string, error)) {
	t.Helper()
	prev := pathIndexFetch
	pathIndexFetch = fn
	t.Cleanup(func() { pathIndexFetch = prev })
}

func TestSyncSatisfiedAssignments_SourceFailureSkipsOnlyThatAssignment(t *testing.T) {
	path := pathWithGuides(t)
	done := completionsFor(path, "2026-09-14T15:00:00Z")
	failing := asg("user:1", "linux-server-integration", "", "onboarding", "2026-09-02T00:00:00Z")
	failing.Name = "failing"
	healthy := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
	healthy.Name = "healthy"
	var mu sync.Mutex
	var updated []string
	lister := singlePageAssignmentLister(failing, healthy)
	lister.updateStatus = func(_ context.Context, _, name, _ string, _ bool) error {
		mu.Lock()
		defer mu.Unlock()
		updated = append(updated, name)
		return nil
	}
	withAssignmentLister(t, lister)
	withLister(t, singlePageLister(done[:len(done)-1]...))
	withPathIndexFetch(t, func(context.Context, string) ([]string, error) { return nil, errors.New("index unreachable") })

	newTestApp(t).syncSatisfiedAssignments(completionRequest(t, "/completion-records", "user:1"), "user:1", done[len(done)-1], log.DefaultLogger)

	mu.Lock()
	defer mu.Unlock()
	if strings.Join(updated, ",") != "healthy" {
		t.Errorf("UpdateStatus names = %v, want only the evaluated assignment", updated)
	}
}

func TestMyAssignments_ReconcilesUnsetSatisfiedStatus(t *testing.T) {
	yes := true
	cases := []struct {
		name        string
		status      *bool
		completions bool
		wantUpdates int32
	}{
		{name: "satisfied with status unset writes once", completions: true, wantUpdates: 1},
		{name: "satisfied with status already true writes nothing", status: &yes, completions: true},
		{name: "unsatisfied writes nothing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withInlineStatusDispatch(t)
			path := pathWithGuides(t)
			target := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
			target.Name = "assignment-1"
			target.ResourceVersion = "9"
			target.StatusSatisfied = tc.status
			var updates int32
			lister := singlePageAssignmentLister(target)
			lister.updateStatus = func(_ context.Context, _, name, resourceVersion string, satisfied bool) error {
				if name != "assignment-1" || resourceVersion != "9" || !satisfied {
					t.Errorf("UpdateStatus(%q, %q, %v)", name, resourceVersion, satisfied)
				}
				atomic.AddInt32(&updates, 1)
				return nil
			}
			withAssignmentLister(t, lister)
			if tc.completions {
				withLister(t, singlePageLister(completionsFor(path, "2026-09-14T15:00:00Z")...))
			}

			rr, _ := doMyAssignments(t, "user:1")

			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rr.Code)
			}
			if n := atomic.LoadInt32(&updates); n != tc.wantUpdates {
				t.Errorf("UpdateStatus calls = %d, want %d", n, tc.wantUpdates)
			}
		})
	}
}

func TestMyAssignments_GuideSourceFailureRule(t *testing.T) {
	sourceDown := &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "boom"}
	forbidden := &appPlatformUpstreamError{status: http.StatusForbidden, msg: "nope"}
	onlineManifest := func() ([]byte, error) { return []byte(`{"type": "path", "milestones": ["online-step"]}`), nil }
	cases := []struct {
		name       string
		target     string
		catalogue  error
		manifest   func() ([]byte, error)
		docsIndex  error
		wantServed bool
		wantGuides []string
	}{
		{name: "an erroring source does not hide a later one", target: "online-path", catalogue: sourceDown, manifest: onlineManifest, wantServed: true, wantGuides: []string{"online-step"}},
		{name: "custom catalogue 403 still resolves an online target", target: "online-path", catalogue: forbidden, manifest: onlineManifest, wantServed: true, wantGuides: []string{"online-step"}},
		{name: "a failed source with no finder omits the assignment", target: "not-a-bundled-path", catalogue: sourceDown, manifest: onlineManifest},
		{name: "a failed online manifest omits the assignment", target: "online-path", manifest: func() ([]byte, error) { return nil, errors.New("manifest unavailable") }},
		{name: "a gone docs index on a bundled URL path omits the assignment and serves 200", target: "linux-server-integration", manifest: onlineManifest, docsIndex: errors.New("status 404")},
		{name: "no failure and no finder is served unresolved", target: "not-a-bundled-path", manifest: onlineManifest, wantServed: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withFetcherOverride(t, func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
				if strings.HasSuffix(rawURL, "manifest.json") {
					return tc.manifest()
				}
				return []byte(`{"online-path": {"path": "online-path/v1", "type": "path"}}`), nil
			})
			withPathIndexFetch(t, func(context.Context, string) ([]string, error) { return nil, tc.docsIndex })
			guides := singlePageGuideLister()
			if tc.catalogue != nil {
				guides = &fakeGuideLister{respond: func(string) (*customGuidePage, error) { return nil, tc.catalogue }}
			}
			withGuideLister(t, guides)
			path := pathWithGuides(t)
			withAssignmentLister(t, singlePageAssignmentLister(
				asg("user:1", tc.target, "", "target-rule", "2026-09-02T00:00:00Z"),
				asg("user:1", path.ID, "", "healthy-rule", "2026-09-01T00:00:00Z"),
			))
			withLister(t, singlePageLister(completionsFor(path, "2026-09-14T15:00:00Z")...))

			rr, resp := doMyAssignments(t, "user:1")

			if rr.Code != http.StatusOK || !resp.Capability.Available {
				t.Fatalf("status = %d, capability = %+v, want 200 available", rr.Code, resp.Capability)
			}
			var served *assignmentEntry
			healthy := false
			for i, e := range resp.Assignments {
				switch e.RuleID {
				case "target-rule":
					served = &resp.Assignments[i]
				case "healthy-rule":
					healthy = e.Satisfied
				}
			}
			if !healthy {
				t.Errorf("assignments = %+v, want the healthy assignment served and satisfied", resp.Assignments)
			}
			if (served != nil) != tc.wantServed {
				t.Fatalf("assignments = %+v, target served = %v, want %v", resp.Assignments, served != nil, tc.wantServed)
			}
			if served == nil {
				return
			}
			var got []string
			for _, g := range served.Guides {
				got = append(got, g.GuideID)
			}
			if !reflect.DeepEqual(got, tc.wantGuides) || served.Satisfied {
				t.Errorf("target = %+v, want unmet with guides %v", *served, tc.wantGuides)
			}
		})
	}
}

func TestMyAssignments_CompletionReadFailure(t *testing.T) {
	cases := []struct {
		name       string
		lister     completionRecordLister
		wantStatus int
		wantReason string
	}{
		{
			name: "transient",
			lister: &fakeLister{respond: func(string) (*completionRecordPage, error) {
				return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "boom"}
			}},
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name: "terminal",
			lister: &fakeLister{respond: func(string) (*completionRecordPage, error) {
				return nil, &appPlatformUpstreamError{status: http.StatusForbidden, msg: "nope"}
			}},
			wantStatus: http.StatusOK,
			wantReason: "upstream-403",
		},
		{name: "structurally unavailable", wantStatus: http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withAssignmentLister(t, singlePageAssignmentLister(asg("user:1", "grafana-fundamentals", "", "onboarding", "2026-09-01T00:00:00Z")))
			if tc.lister != nil {
				withLister(t, tc.lister)
			} else {
				prev := completionListerOverride
				completionListerOverride = nil
				t.Cleanup(func() { completionListerOverride = prev })
			}

			rr, resp := doMyAssignments(t, "user:1")

			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tc.wantStatus)
			}
			if tc.wantStatus == http.StatusServiceUnavailable {
				if rr.Header().Get("Retry-After") == "" {
					t.Error("expected Retry-After on a transient 503")
				}
				return
			}
			if resp.Capability.Available || resp.Capability.Reason == "" || len(resp.Assignments) != 0 {
				t.Errorf("response = %+v, want capability false with a reason", resp)
			}
			if tc.wantReason != "" && resp.Capability.Reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", resp.Capability.Reason, tc.wantReason)
			}
		})
	}
}
