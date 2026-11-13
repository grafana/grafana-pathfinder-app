package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/publiccontent"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func contractClient(t *testing.T, body func(*http.Request) any) resource.ClientGenerator {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(body(r)); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	return sdkplugin.BuildClientGenerator(rest.Config{Host: server.URL, APIPath: "/apis"})
}

func captureSDK(t *testing.T, subject string, handler simple.AppCustomRouteHandler) *httptest.ResponseRecorder {
	t.Helper()
	ctx := context.Background()
	if subject != "" {
		ctx = authlib.WithAuthInfo(ctx, completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: subject})
	}
	w := httptest.NewRecorder()
	if err := handler(ctx, w, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	normalizeContractTime(t, w)
	return w
}

func normalizeContractTime(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if stamp, ok := body["asOf"].(string); ok {
		if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
			t.Fatal(err)
		}
		body["asOf"] = "2026-04-01T00:00:00Z"
	}
	w.Body.Reset()
	if err := json.NewEncoder(w.Body).Encode(body); err != nil {
		t.Fatal(err)
	}
}

func doCustomGuideGolden(t *testing.T, subject string, entries ...services.CatalogueEntry) *httptest.ResponseRecorder {
	items := make([]any, 0, len(entries))
	for _, entry := range entries {
		items = append(items, map[string]any{"metadata": map[string]string{"name": entry.ID}, "spec": entry})
	}
	store, err := resourceaccess.NewGuideStore(contractClient(t, func(*http.Request) any { return map[string]any{"items": items} }))
	if err != nil {
		t.Fatal(err)
	}
	return captureSDK(t, subject, catalogueReadHandler(store))
}
func captureCustomGuideUnavailable(t *testing.T) *httptest.ResponseRecorder {
	return doCustomGuideGolden(t, "")
}
func doCustomGuidesGolden(t *testing.T, body string) *httptest.ResponseRecorder {
	store, err := resourceaccess.NewGuideStore(contractClient(t, func(*http.Request) any { return json.RawMessage(body) }))
	if err != nil {
		t.Fatal(err)
	}
	return captureSDK(t, "user:1", guidesReadHandler(store))
}
func rec(userID, guideSource, guideID, title, category, pathID, source, completedAt string, percent int64) services.CompletionRecord {
	return services.CompletionRecord{UserID: userID, GuideSource: guideSource, GuideID: guideID, GuideTitle: title, GuideCategory: category, PathID: pathID, Source: source, CompletedAt: completedAt, CompletionPercent: percent}
}
func completionItems(records []services.CompletionRecord) []any {
	items := make([]any, 0, len(records))
	for i, record := range records {
		items = append(items, map[string]any{"metadata": map[string]any{"name": fmt.Sprint(i), "annotations": map[string]string{"grafana.app/updatedTimestamp": record.LastUpdatedAt, "pathfinder.grafana.com/attempt-started-at": record.AttemptStartedAt}}, "spec": record})
	}
	return items
}
func doCompletionGolden(t *testing.T, subject string, capability bool, records ...services.CompletionRecord) *httptest.ResponseRecorder {
	services.ResetCompletionCache()
	t.Cleanup(services.ResetCompletionCache)
	store, err := resourceaccess.NewCompletionStore(contractClient(t, func(*http.Request) any { return map[string]any{"items": completionItems(records)} }))
	if err != nil {
		t.Fatal(err)
	}
	return captureSDK(t, subject, completionReadHandler(store, capability))
}
func captureRecommendations(t *testing.T, entries []publiccontent.PackageEntry) *httptest.ResponseRecorder {
	body, err := json.Marshal(publiccontent.PackageRecommendationsResponse{BaseURL: "https://interactive-learning.grafana.net/", Packages: entries})
	if err != nil {
		t.Fatal(err)
	}
	return captureSDK(t, "", recommendationsHandler(func(context.Context) (json.RawMessage, bool, error) { return body, true, nil }))
}
func capturePackageRecommendationsDefault(t *testing.T) *httptest.ResponseRecorder {
	var entry publiccontent.PackageEntry
	if err := json.Unmarshal([]byte(`{"id":"prom-101","path":"prom-101/v1.0.0","type":"guide","title":"Prometheus 101","description":"Get started with Prometheus","targeting":{"match":{"urlPrefix":"/connections","cohort":"new-user"}},"manifest":{"id":"prom-101","type":"guide","milestones":["prom-101-a","prom-101-b"]}}`), &entry); err != nil {
		t.Fatal(err)
	}
	return captureRecommendations(t, []publiccontent.PackageEntry{entry})
}
func capturePackageRecommendationsUntargeted(t *testing.T) *httptest.ResponseRecorder {
	return captureRecommendations(t, []publiccontent.PackageEntry{{ID: "untargeted", Path: "untargeted/v1.0.0"}})
}
func capturePackageRecommendationsEmpty(t *testing.T) *httptest.ResponseRecorder {
	return captureRecommendations(t, []publiccontent.PackageEntry{})
}
func contractEvaluator(ctx context.Context, _ string) *services.ObligationEvaluator {
	return &services.ObligationEvaluator{Context: ctx, Logger: log.DefaultLogger}
}
func doAssignmentsGolden(t *testing.T, subject string, records ...services.Assignment) *httptest.ResponseRecorder {
	deps := assignmentRouteDependencies{
		Assignments: assignmentReaderFunc(func(context.Context, string, string) (*services.AssignmentPage, error) {
			return &services.AssignmentPage{Records: records}, nil
		}),
		ReadCompletions: func(context.Context, string, string) ([]services.CompletionRecord, error) {
			return []services.CompletionRecord{rec("user:1", "bundled", "welcome-to-grafana", "Welcome", "interactive", "", "manual", "2026-03-27T15:00:00Z", 100)}, nil
		},
		Evaluator: contractEvaluator, MarkSatisfied: func(context.Context, string, []services.Assignment) {}, Allow: func(string, string) (bool, time.Duration) { return true, 0 },
	}
	return captureSDK(t, subject, assignmentsReadHandler(deps))
}
func contractAssignment(user string) services.Assignment {
	return services.Assignment{Name: "onboarding-alex", UserID: user, TargetType: "guide", TargetID: "welcome-to-grafana", TargetSource: "bundled", Lifecycle: "active", RuleID: "onboarding", AssignedBy: "gtm-enablement", AssignedAt: "2026-03-26T00:00:00Z", DueAt: "2026-05-15T00:00:00Z", AcceptCompletionsFrom: "2026-01-01T00:00:00Z"}
}
func captureMyAssignmentsDefault(t *testing.T) *httptest.ResponseRecorder {
	unresolved := contractAssignment("user:1")
	unresolved.TargetType = "path"
	unresolved.TrackID = "seller"
	unresolved.TargetID = "unknown-path"
	return doAssignmentsGolden(t, "user:1", contractAssignment("user:1"), unresolved, contractAssignment("user:2"))
}
func captureMyAssignmentsEmpty(t *testing.T) *httptest.ResponseRecorder {
	return doAssignmentsGolden(t, "user:nobody", contractAssignment("user:1"))
}
func captureMyAssignmentsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	return doAssignmentsGolden(t, "")
}
func captureLearningInsightsDefault(t *testing.T) *httptest.ResponseRecorder {
	completion := rec("user:1", "bundled", "welcome-to-grafana", "Welcome to Grafana", "interactive", "", "objectives", "2026-09-15T12:00:00Z", 100)
	completion.UserLogin = "alex"
	completion.UserDisplayName = "Alex Example"
	generator := contractClient(t, func(r *http.Request) any {
		if strings.Contains(r.URL.Path, "completionrecords") {
			return map[string]any{"items": completionItems([]services.CompletionRecord{completion})}
		}
		return map[string]any{"items": []any{map[string]any{"metadata": map[string]string{"name": "onboarding-alex"}, "spec": contractAssignment("user:1")}}}
	})
	completions, err := resourceaccess.NewCompletionStore(generator)
	if err != nil {
		t.Fatal(err)
	}
	assignments, err := resourceaccess.NewAssignmentStore(generator)
	if err != nil {
		t.Fatal(err)
	}
	handler := insightsReadHandler(completions, assignments, contractEvaluator, func(string, string) (bool, time.Duration) { return true, 0 })
	payload := `{"sub":"user:admin","namespace":"default","role":"Admin"}`
	identity := adminIdentity{completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:admin"}, idToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"}
	ctx := authlib.WithAuthInfo(context.Background(), identity)
	u, _ := url.Parse("http://local/insights?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z")
	w := httptest.NewRecorder()
	if err := handler(ctx, w, &app.CustomRouteRequest{Method: http.MethodGet, URL: u, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	normalizeContractTime(t, w)
	return w
}
func captureCustomGuideDefault(t *testing.T) *httptest.ResponseRecorder {
	full := services.CatalogueEntry{
		ID:     "fe-alerting-path",
		Title:  "Alerting enablement",
		Status: "published",
		Manifest: &services.CatalogueManifest{
			Type:        "path",
			Repository:  "app-platform",
			Description: "Take a team from zero to on-call",
			Milestones:  []string{"fe-alerting-01", "fe-alerting-02"},
			Category:    "alerting",
			Author: &struct {
				Name string `json:"name,omitempty"`
				Team string `json:"team,omitempty"`
			}{Name: "Field engineering", Team: "field-eng"},
			Depends: []json.RawMessage{json.RawMessage(`"fe-intro"`), json.RawMessage(`["fe-loki","fe-mimir"]`)},
			Stats: &services.CatalogueStats{
				Version:                  1,
				BlockCount:               9,
				SectionCount:             3,
				CompletableBlockCount:    4,
				FinalCompletablePosition: 7,
			},
		},
	}
	bare := services.CatalogueEntry{ID: "fe-alerting-01"}
	return doCustomGuideGolden(t, "user:1", full, bare)
}
func captureCustomGuideWireWidenedManifest(t *testing.T) *httptest.ResponseRecorder {
	entry := services.CatalogueEntry{
		ID: "fe-untyped",
		Manifest: &services.CatalogueManifest{
			Depends: []json.RawMessage{json.RawMessage(`{"package":"fe-intro","version":">=1"}`), json.RawMessage(`7`)},
		},
	}
	return doCustomGuideGolden(t, "user:1", entry)
}
func captureCustomGuidesDefault(t *testing.T) *httptest.ResponseRecorder {
	return doCustomGuidesGolden(t, `{"items":[{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"InteractiveGuide","metadata":{"name":"editor-guide","uid":"uid-editor","resourceVersion":"42","creationTimestamp":"2026-10-01T00:00:00Z","annotations":{"source":"editor"},"labels":{"team":"observability"}},"spec":{"id":"editor-guide","title":"Team guide","status":"draft","blocks":[{"type":"markdown","content":"Hello"}],"manifest":{"type":"guide"}},"futureField":{"preserve":true}}]}`)
}
func captureCustomGuidesEmpty(t *testing.T) *httptest.ResponseRecorder {
	return doCustomGuidesGolden(t, `{"items":[]}`)
}
func captureMyCompletionsDefault(t *testing.T) *httptest.ResponseRecorder {
	annotated := func(r services.CompletionRecord, duration int64, updated, started string) services.CompletionRecord {
		r.DurationSeconds, r.LastUpdatedAt, r.AttemptStartedAt = duration, updated, started
		return r
	}
	return doCompletionGolden(t, "user:1", false,
		annotated(rec("user:1", "app-platform", "fe-alerting-01", "Alerting module 1", "interactive", "fe-alerting-path", "objectives", "2026-03-30T09:00:00Z", 100), 742, "2026-03-30T09:00:05Z", "2026-03-30T08:47:00Z"),
		rec("user:1", "app-platform", "fe-alerting-01", "Alerting module 1", "interactive", "fe-alerting-path", "manual", "2026-03-29T09:00:00Z", 60),
		rec("user:1", "bundled", "linux", "Linux server integration", "interactive", "", "objectives", "2026-03-28T09:00:00Z", 80),
		rec("user:2", "bundled", "loki", "Loki basics", "interactive", "", "objectives", "2026-03-27T09:00:00Z", 100),
	)
}
func captureMyCompletionsInProgress(t *testing.T) *httptest.ResponseRecorder {
	partial := func(guideSource, guideID, title string, percent int64, updated string) services.CompletionRecord {
		r := rec("user:1", guideSource, guideID, title, "interactive", "", "objectives", "", percent)
		r.LastUpdatedAt = updated
		r.AttemptStartedAt = "2026-03-29T08:30:00Z"
		return r
	}
	done := rec("user:1", "bundled", "linux", "Linux server integration", "interactive", "", "manual", "2026-03-28T09:00:00Z", 100)
	done.LastUpdatedAt = "2026-03-28T09:00:00Z"
	done.DurationSeconds = 310
	done.AttemptStartedAt = "2026-03-28T08:50:00Z"
	return doCompletionGolden(t, "user:1", false,
		done,
		partial("bundled", "linux", "Linux server integration", 40, "2026-03-29T09:00:00Z"),
		partial("app-platform", "fe-alerting-01", "Alerting module 1", 60, "2026-03-30T09:00:00Z"),
	)
}
func captureMyCompletionsEmpty(t *testing.T) *httptest.ResponseRecorder {
	return doCompletionGolden(t, "user:nobody", false,
		rec("user:1", "bundled", "linux", "Linux server integration", "interactive", "", "objectives", "2026-03-28T09:00:00Z", 80),
	)
}
func captureMyCompletionsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	return doCompletionGolden(t, "", false)
}
func captureCapabilityAvailable(t *testing.T) *httptest.ResponseRecorder {
	return doCompletionGolden(t, "user:1", true)
}
func captureCapabilityUnavailable(t *testing.T) *httptest.ResponseRecorder {
	return doCompletionGolden(t, "", true)
}
