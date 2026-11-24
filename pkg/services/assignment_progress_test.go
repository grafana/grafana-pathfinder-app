package services

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"reflect"
	"strings"
	"testing"
)

func newTestEvaluator(sources ...PathGuideSource) *ObligationEvaluator {
	return &ObligationEvaluator{Context: context.Background(), Logger: log.DefaultLogger, Sources: sources}
}
func mustGuideProgress(t *testing.T, ev *ObligationEvaluator, asg Assignment, completions []CompletionRecord) []AssignmentGuideEntry {
	t.Helper()
	guides, err := ev.GuideProgress(asg, completions)
	if err != nil {
		t.Fatalf("guideProgress: %v", err)
	}
	return guides
}
func guideEntry(id, title, status, manifestType string) CatalogueEntry {
	e := CatalogueEntry{ID: id, Title: title, Status: status}
	if manifestType != "" {
		e.Manifest = &CatalogueManifest{Type: manifestType, Repository: "app-platform"}
	}
	return e
}
func TestDirectGuideProgress_SourceAndTerminalEvidence(t *testing.T) {
	asg := Assignment{TargetType: "guide", TargetID: "same-slug", TargetSource: "app-platform", AcceptCompletionsFrom: "2026-01-01T00:00:00Z"}
	for _, tc := range []struct {
		name, source, at string
		want             bool
	}{
		{"wrong source", "bundled", "2026-02-01T00:00:00Z", false},
		{"missing source", "", "2026-02-01T00:00:00Z", false},
		{"partial", "app-platform", "", false},
		{"malformed timestamp", "app-platform", "invalid", false},
		{"old completion", "app-platform", "2025-12-31T23:59:59Z", false},
		{"cutoff inclusive", "app-platform", "2026-01-01T00:00:00Z", true},
		{"terminal completion", "app-platform", "2026-02-01T00:00:00Z", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := []CompletionRecord{{GuideID: asg.TargetID, GuideSource: tc.source, CompletedAt: tc.at, CompletionPercent: 100}}
			guides := mustGuideProgress(t, newTestEvaluator(), asg, rows)
			if len(guides) != 1 || guides[0].GuideSource != asg.TargetSource || SatisfiedFromGuides(guides) != tc.want {
				t.Fatalf("guides = %+v, want completed %v", guides, tc.want)
			}
		})
	}
	for _, invalid := range []Assignment{
		{TargetType: "guide", TargetID: "same-slug"},
		{TargetType: "guide", TargetSource: "bundled"},
		{TargetType: "guide", TargetID: "same-slug", TargetSource: "bundled", TrackID: "ops"},
	} {
		if got := mustGuideProgress(t, newTestEvaluator(), invalid, nil); got != nil {
			t.Fatalf("invalid guide target resolved: %+v", got)
		}
	}
}
func TestCustomPathGuides_RecorderSourceOverridesManifest(t *testing.T) {
	path := guideEntry("mixed-path", "Mixed path", "published", "path")
	path.Manifest.Repository = "interactive-tutorials"
	path.Manifest.Milestones = []string{"local", "external", "external"}
	local := guideEntry("local", "Local", "published", "guide")
	external := guideEntry("external", "External", "published", "guide")
	external.Manifest.Repository = "online-cdn"
	source := CustomPathGuides([]CatalogueEntry{path, local, external}, log.DefaultLogger)
	ev := newTestEvaluator(source)
	asg := Assignment{TargetType: "path", TargetID: path.ID, TargetSource: "app-platform"}
	rows := []CompletionRecord{
		{GuideID: "local", GuideSource: "app-platform", CompletedAt: "2026-01-01T00:00:00Z", CompletionPercent: 100},
		{GuideID: "external", GuideSource: "app-platform", CompletedAt: "2026-01-01T00:00:00Z", CompletionPercent: 100},
	}
	guides := mustGuideProgress(t, ev, asg, rows)
	want := []AssignmentGuideEntry{{GuideID: "local", GuideSource: "app-platform", Completed: true}, {GuideID: "external", GuideSource: "app-platform", Completed: true}}
	if !reflect.DeepEqual(guides, want) {
		t.Fatalf("guides = %+v, want %+v", guides, want)
	}
	rows[1].GuideSource = "online-cdn"
	if SatisfiedFromGuides(mustGuideProgress(t, ev, asg, rows)) {
		t.Fatal("manifest repository granted public-source credit to a custom member")
	}
	asg.TargetSource = "bundled"
	if got := mustGuideProgress(t, ev, asg, rows); got != nil {
		t.Fatalf("target source collision resolved: %+v", got)
	}
}
func TestGuideProgress_UnknownAndFailureStayUnknown(t *testing.T) {
	for _, tc := range []struct {
		name  string
		found bool
		err   error
	}{
		{name: "unknown"},
		{name: "missing track", found: true},
		{name: "failed lookup", err: errors.New("unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			source := func(context.Context, string, string, string) ([]AssignmentGuideIdentity, bool, error) {
				calls++
				return nil, tc.found, tc.err
			}
			ev := newTestEvaluator(source)
			asg := Assignment{TargetType: "path", TargetID: "unknown"}
			for range 2 {
				guides, err := ev.GuideProgress(asg, nil)
				if guides != nil || (err != nil) != (tc.err != nil) {
					t.Fatalf("guides = %+v, error = %v", guides, err)
				}
			}
			if calls != 1 {
				t.Fatalf("source called %d times", calls)
			}
		})
	}
}
func TestAssignmentGuideEntry_RequiredSourceJSON(t *testing.T) {
	body, err := json.Marshal(AssignmentGuideEntry{GuideID: "guide"})
	if err != nil || !strings.Contains(string(body), `"guideSource":""`) {
		t.Fatalf("required guideSource missing from %s: %v", body, err)
	}
}
