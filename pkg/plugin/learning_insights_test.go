package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func insightsRequest(t *testing.T, role, sub string) *http.Request {
	t.Helper()
	r := completionRequest(t, "/learning-insights?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z", sub)
	pc := backend.PluginConfigFromContext(r.Context())
	if role != "" {
		pc.User = &backend.User{Role: role}
	}
	return r.WithContext(backend.WithPluginContext(r.Context(), pc))
}

func insightsResponse(t *testing.T, r *http.Request) (*httptest.ResponseRecorder, learningInsightsResponse) {
	t.Helper()
	return insightsResponseWith(t, newTestApp(t), r)
}

func insightsResponseWith(t *testing.T, app *App, r *http.Request) (*httptest.ResponseRecorder, learningInsightsResponse) {
	t.Helper()
	rr := httptest.NewRecorder()
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	mux.ServeHTTP(rr, r)
	var resp learningInsightsResponse
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	if rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store")
	}
	return rr, resp
}

func TestLearningInsightsAuthorization(t *testing.T) {
	l := singlePageLister()
	withLister(t, l)
	for _, role := range []string{"", "Viewer", "Editor", "admin"} {
		rr, _ := insightsResponse(t, insightsRequest(t, role, "user:1"))
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %q: %d", role, rr.Code)
		}
	}
	for _, sub := range []string{"", "user:1"} {
		r := insightsRequest(t, "Admin", sub)
		if sub != "" {
			pc := backend.PluginConfigFromContext(r.Context())
			pc.Namespace = "other-stack"
			r = r.WithContext(backend.WithPluginContext(r.Context(), pc))
		}
		_, resp := insightsResponse(t, r)
		if resp.Capability.Available || len(resp.People) != 0 {
			t.Fatalf("identity served: %+v", resp)
		}
	}
	if l.callCount() != 0 {
		t.Fatal("unauthorized upstream read")
	}
}

func TestLearningInsightsEmptyAndFailures(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister())
	_, resp := insightsResponse(t, insightsRequest(t, "Admin", "user:1"))
	if !resp.Capability.Available || resp.Completeness != "complete" || resp.People == nil || resp.Assignments == nil || resp.Completions == nil {
		t.Fatalf("empty response: %+v", resp)
	}
	withLister(t, &fakeLister{respond: func(string) (*completionRecordPage, error) { return nil, errors.New("offline") }})
	_, resp = insightsResponse(t, insightsRequest(t, "Admin", "user:1"))
	if resp.Completeness != "partial" || len(resp.Warnings) != 1 || resp.Warnings[0] != "completions-fetch-failed" {
		t.Fatalf("failure: %+v", resp)
	}
}

func TestLearningInsightsDrainBounds(t *testing.T) {
	calls := 0
	rows, complete, reason := drainInsights(context.Background(), func(token string) ([]int, string, error) { calls++; return []int{1}, token + "x", nil })
	if complete || reason != "page-limit" || calls != learningInsightsMaxPages || len(rows) != calls {
		t.Fatal(calls, reason, rows)
	}
	_, complete, reason = drainInsights(context.Background(), func(string) ([]int, string, error) { return make([]int, learningInsightsMaxItems+1), "", nil })
	if complete || reason != "item-limit" {
		t.Fatal(reason)
	}
	_, complete, reason = drainInsights(context.Background(), func(string) ([]int, string, error) { return nil, "same", nil })
	if complete || reason != "pagination-cycle" {
		t.Fatal(reason)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, complete, reason = drainInsights(ctx, func(string) ([]int, string, error) { t.Fatal("called canceled page"); return nil, "", nil })
	if complete || reason != "deadline" {
		t.Fatal(reason)
	}
	rows, complete, reason = drainInsights(context.Background(), func(token string) ([]int, string, error) {
		if token == "" {
			return []int{7}, "next", nil
		}
		return nil, "", errors.New("failed")
	})
	if complete || reason != "fetch-failed" || len(rows) != 1 {
		t.Fatal(rows, reason)
	}
}

func TestLearningInsightsMetrics(t *testing.T) {
	from, _ := time.Parse(time.RFC3339, "2026-09-01T00:00:00Z")
	to := from.AddDate(0, 1, 0)
	rec := func(user, source, at string, percent int64) completionRecordSpec {
		return completionRecordSpec{UserID: user, GuideID: "g", GuideSource: source, CompletedAt: at, CompletionPercent: percent, RecordedAt: at}
	}
	records := []completionRecordSpec{
		rec("user:1", "bundled", "2026-08-01T00:00:00Z", 100),
		rec("user:1", "bundled", "2026-09-02T00:00:00Z", 100),
		rec("user:1", "bundled", "2026-09-01T00:00:00Z", 100),
		rec("user:1", "bundled", "2026-09-03T00:00:00Z", 99),
		rec("user:1", "custom", "2026-09-04T00:00:00Z", 100),
		rec("user:2", "bundled", "2026-10-01T00:00:00Z", 100),
		rec("user:3", "bundled", "2026-07-01T00:00:00Z", 100),
	}
	records[0].UserLogin = "old"
	records[2].UserLogin, records[2].UserDisplayName = "new", "New name"
	assignments := []assignmentSpec{asg("user:1", "g", "", "r", ""), asg("user:4", "g", "", "r", "")}
	assignments[0].TargetType, assignments[0].TargetSource = "guide", "bundled"
	assignments[0].AcceptCompletionsFrom = "2026-07-01T00:00:00Z"
	assignments[1].DueAt = "2026-08-01T00:00:00Z"
	progress := func(asg assignmentSpec, history []completionRecordSpec) ([]assignmentGuideEntry, error) {
		done := false
		for _, rec := range history {
			if rec.CompletedAt == "2026-08-01T00:00:00Z" {
				done = true
			}
		}
		return []assignmentGuideEntry{{GuideID: "g", Completed: done}}, nil
	}
	resp := newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, assignments, from, to, to, true, progress)
	if len(resp.Completions) != 2 || resp.Completions[0].CompletedAt != "2026-09-01T00:00:00Z" {
		t.Fatalf("dedup: %+v", resp.Completions)
	}
	if len(resp.People) != 4 || resp.People[0].UserLogin != "new" || resp.People[2].UserDisplayName != "" {
		t.Fatalf("people: %+v", resp.People)
	}
	if resp.Assignments[0].Status != "complete" || resp.Assignments[1].Status != "overdue" {
		t.Fatalf("assignments: %+v", resp.Assignments)
	}
	resp = newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, assignments, from, to, to, false, progress)
	if resp.Assignments[0].Status != "complete" || resp.Assignments[1].Status != "unknown" {
		t.Fatal(resp.Assignments)
	}
	assignments[0].Lifecycle = "withdrawn"
	resp = newLearningInsightsResponse(from, to)
	shapeLearningInsights(&resp, records, assignments, from, to, to, true, func(assignmentSpec, []completionRecordSpec) ([]assignmentGuideEntry, error) {
		return nil, errors.New("failed")
	})
	if resp.Assignments[0].Status != "withdrawn" || resp.Assignments[1].Status != "unknown" {
		t.Fatal(resp.Assignments)
	}
}

func TestLearningInsightsInvalidPeriod(t *testing.T) {
	r := insightsRequest(t, "Admin", "user:1")
	r.URL.RawQuery = "from=not-a-time"
	rr, _ := insightsResponse(t, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatal(rr.Code)
	}
}

func TestLearningInsightsReadRateLimit(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	completions := singlePageLister()
	withLister(t, completions)
	assignments := singlePageAssignmentLister()
	withAssignmentLister(t, assignments)
	app := newTestApp(t)
	app.assignmentsReadRateLimiter = newUserRateLimiter(1, 1)
	for _, role := range []string{"Viewer", "Editor", ""} {
		rr, _ := insightsResponseWith(t, app, insightsRequest(t, role, "user:1"))
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %q: %d", role, rr.Code)
		}
	}
	for _, identity := range []string{"missing", "foreign-namespace"} {
		sub := ""
		if identity == "foreign-namespace" {
			sub = "user:1"
		}
		r := insightsRequest(t, "Admin", sub)
		if identity == "foreign-namespace" {
			pc := backend.PluginConfigFromContext(r.Context())
			pc.Namespace = "other-stack"
			r = r.WithContext(backend.WithPluginContext(r.Context(), pc))
		}
		rr, resp := insightsResponseWith(t, app, r)
		if rr.Code != http.StatusOK || resp.Capability.Available {
			t.Fatalf("identity %s: %d %+v", identity, rr.Code, resp)
		}
	}
	if len(app.assignmentsReadRateLimiter.buckets) != 0 || completions.callCount() != 0 || assignments.callCount() != 0 {
		t.Fatal("rejected callers consumed rate budget or read upstream")
	}
	rr, _ := insightsResponseWith(t, app, insightsRequest(t, "Admin", "user:1"))
	if rr.Code != http.StatusOK {
		t.Fatalf("first verified read: %d", rr.Code)
	}
	completionCalls, assignmentCalls := completions.callCount(), assignments.callCount()
	rr, _ = insightsResponseWith(t, app, insightsRequest(t, "Admin", "user:1"))
	if rr.Code != http.StatusTooManyRequests || rr.Header().Get("Retry-After") != "1" || rr.Body.String() != "{\"error\":\"rate-limited\"}\n" {
		t.Errorf("over-budget response: %d %s %s", rr.Code, rr.Header().Get("Retry-After"), rr.Body.String())
	}
	if completions.callCount() != completionCalls || assignments.callCount() != assignmentCalls {
		t.Fatal("rate-limited request read upstream")
	}
	rr, _ = insightsResponseWith(t, app, insightsRequest(t, "Admin", "user:2"))
	if rr.Code != http.StatusOK {
		t.Fatalf("another verified caller: %d", rr.Code)
	}
	if len(app.assignmentsReadRateLimiter.buckets) != 2 {
		t.Fatal("limiter is not keyed on verified subjects")
	}
}
