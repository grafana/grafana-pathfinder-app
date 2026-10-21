package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestDirectGuideProgress_SourceAndTerminalEvidence(t *testing.T) {
	asg := assignmentSpec{TargetType: "guide", TargetID: "same-slug", TargetSource: "app-platform", AcceptCompletionsFrom: "2026-01-01T00:00:00Z"}
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
			rows := []completionRecordSpec{{GuideID: asg.TargetID, GuideSource: tc.source, CompletedAt: tc.at}}
			guides := mustGuideProgress(t, newTestEvaluator(), asg, rows)
			if len(guides) != 1 || guides[0].GuideSource != asg.TargetSource || satisfiedFromGuides(guides) != tc.want {
				t.Fatalf("guides = %+v, want completed %v", guides, tc.want)
			}
		})
	}
	for _, invalid := range []assignmentSpec{
		{TargetType: "guide", TargetID: "same-slug"},
		{TargetType: "guide", TargetSource: "bundled"},
		{TargetType: "guide", TargetID: "same-slug", TargetSource: "bundled", TrackID: "ops"},
	} {
		if got := mustGuideProgress(t, newTestEvaluator(), invalid, nil); got != nil {
			t.Fatalf("invalid guide target resolved: %+v", got)
		}
	}
}

func TestCustomPathGuides_PreservesMemberSources(t *testing.T) {
	path := guideEntry("mixed-path", "Mixed path", "published", "path")
	path.Manifest.Milestones = []string{"local", "external", "external"}
	local := guideEntry("local", "Local", "published", "guide")
	external := guideEntry("external", "External", "published", "guide")
	external.Manifest.Repository = "online-cdn"
	source := customPathGuides([]customGuideRepositoryEntry{path, local, external}, log.DefaultLogger)
	ev := newTestEvaluator(source)
	asg := assignmentSpec{TargetType: "path", TargetID: path.ID, TargetSource: "app-platform"}
	rows := []completionRecordSpec{
		{GuideID: "local", GuideSource: "app-platform", CompletedAt: "2026-01-01T00:00:00Z"},
		{GuideID: "external", GuideSource: "app-platform", CompletedAt: "2026-01-01T00:00:00Z"},
	}
	guides := mustGuideProgress(t, ev, asg, rows)
	want := []assignmentGuideEntry{{GuideID: "local", GuideSource: "app-platform", Completed: true}, {GuideID: "external", GuideSource: "online-cdn"}}
	if !reflect.DeepEqual(guides, want) {
		t.Fatalf("guides = %+v, want %+v", guides, want)
	}
	rows[1].GuideSource = "online-cdn"
	if !satisfiedFromGuides(mustGuideProgress(t, ev, asg, rows)) {
		t.Fatal("matching member sources did not satisfy assignment")
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
			source := func(context.Context, string, string, string) ([]assignmentGuideIdentity, bool, error) {
				calls++
				return nil, tc.found, tc.err
			}
			ev := newTestEvaluator(source)
			asg := assignmentSpec{TargetType: "path", TargetID: "unknown"}
			for range 2 {
				guides, err := ev.guideProgress(asg, nil)
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

func TestOnlinePathGuides_MemberManifestsAndFailures(t *testing.T) {
	for _, failMember := range []bool{false, true} {
		t.Run(map[bool]string{false: "sources", true: "member failure"}[failMember], func(t *testing.T) {
			resetPackageRecommendationsCache()
			withFetcherOverride(t, func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
				switch {
				case strings.HasSuffix(rawURL, "repository.json"):
					return []byte(`{"path":{"path":"path/v1","type":"path"},"a":{"path":"guides/slug-a","type":"guide"},"b":{"path":"guides/slug-b","type":"guide"}}`), nil
				case strings.Contains(rawURL, "/path/v1/"):
					return []byte(`{"type":"path","repository":"interactive-tutorials","milestones":["a","b"]}`), nil
				case strings.Contains(rawURL, "/slug-a/"):
					return []byte(`{"repository":"online-cdn"}`), nil
				case strings.Contains(rawURL, "/slug-b/"):
					if failMember {
						return nil, errors.New("member unavailable")
					}
					return []byte(`{"repository":"interactive-tutorials"}`), nil
				default:
					t.Fatalf("unexpected URL %s", rawURL)
					return nil, nil
				}
			})
			ev := newTestEvaluator(newTestApp(t).onlinePathGuides(log.DefaultLogger))
			guides, err := ev.guideProgress(assignmentSpec{TargetType: "path", TargetID: "path", TargetSource: "interactive-tutorials"}, nil)
			if failMember {
				if guides != nil || !errors.Is(err, errAssignmentUncheckable) {
					t.Fatalf("guides = %+v, error = %v", guides, err)
				}
				return
			}
			want := []assignmentGuideEntry{{GuideID: "slug-a", GuideSource: "online-cdn"}, {GuideID: "slug-b", GuideSource: "interactive-tutorials"}}
			if err != nil || !reflect.DeepEqual(guides, want) {
				t.Fatalf("guides = %+v, error = %v", guides, err)
			}
		})
	}
}

func TestPathGuides_MissingRequiredMemberStaysUnresolved(t *testing.T) {
	for _, trackID := range []string{"", "ops"} {
		for _, state := range []string{"missing", "draft", "missing manifest"} {
			t.Run(trackID+"/"+state, func(t *testing.T) {
				path := guideEntry("path", "Path", "published", "path")
				path.Manifest.Milestones = []string{"present", "absent"}
				path.Manifest.Tracks = []customGuideManifestTrack{{TrackID: "ops", Guides: path.Manifest.Milestones}}
				entries := []customGuideRepositoryEntry{path, guideEntry("present", "Present", "published", "guide")}
				if state != "missing" {
					member := guideEntry("absent", "Absent", "published", "guide")
					if state == "draft" {
						member.Status = "draft"
					} else {
						member.Manifest = nil
					}
					entries = append(entries, member)
				}
				ev := newTestEvaluator(customPathGuides(entries, log.DefaultLogger))
				got := mustGuideProgress(t, ev, assignmentSpec{TargetType: "path", TargetID: "path", TargetSource: "app-platform", TrackID: trackID}, []completionRecordSpec{{GuideID: "present", GuideSource: "app-platform", CompletedAt: "2026-01-01T00:00:00Z"}})
				if got != nil {
					t.Fatalf("incomplete membership resolved: %+v", got)
				}
			})
		}
	}
	resp := &PackageRecommendationsResponse{Packages: []PackageEntry{{ID: "present", Path: "guides/present", Manifest: map[string]interface{}{"repository": "bundled"}}}}
	guides, err := newTestApp(t).resolveOnlineGuideIdentities(context.Background(), resp, []interface{}{"present", "absent"})
	if err != nil || guides != nil {
		t.Fatalf("missing online member resolved: %+v, %v", guides, err)
	}
}

func TestAssignmentGuideEntry_RequiredSourceJSON(t *testing.T) {
	body, err := json.Marshal(assignmentGuideEntry{GuideID: "guide"})
	if err != nil || !strings.Contains(string(body), `"guideSource":""`) {
		t.Fatalf("required guideSource missing from %s: %v", body, err)
	}
}
