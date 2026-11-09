package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestAssignmentSourceChainParity(t *testing.T) {
	bundled := pathWithGuides(t)
	cases := []struct {
		name   string
		target string
		source string
		want   []assignmentGuideIdentity
	}{
		{"bundled wins unqualified collision", bundled.ID, "", guideIdentities(bundled.Guides, "bundled")},
		{"qualified bundled", bundled.ID, "bundled", guideIdentities(bundled.Guides, "bundled")},
		{"custom wins over online", "parity-custom", "", guideIdentities([]string{"custom-member"}, "app-platform")},
		{"qualified custom bypasses bundled", bundled.ID, "app-platform", guideIdentities([]string{"custom-member"}, "app-platform")},
		{"online fallback", "parity-online", "", []assignmentGuideIdentity{onlineAssignmentGuide("recorder-slug")}},
		{"qualified online bypasses bundled and custom", bundled.ID, "interactive-tutorials", []assignmentGuideIdentity{onlineAssignmentGuide("recorder-slug")}},
	}
	constructors := []struct {
		name  string
		build func(*App, *http.Request) *obligationEvaluator
	}{
		{"learner", (*App).newObligationEvaluator},
		{"insights", (*App).insightsObligationEvaluator},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, constructor := range constructors {
				t.Run(constructor.name, func(t *testing.T) {
					resetPackageRecommendationsCache()
					var custom []customGuideRepositoryEntry
					for _, id := range []string{bundled.ID, "parity-custom"} {
						path := guideEntry(id, id, "published", "path")
						path.Manifest.Repository = "interactive-tutorials"
						path.Manifest.Milestones = []string{"custom-member"}
						custom = append(custom, path)
					}
					member := guideEntry("custom-member", "Member", "published", "guide")
					member.Manifest.Repository = "online-cdn"
					custom = append(custom, member)
					withGuideLister(t, singlePageGuideLister(custom...))
					repository := map[string]interface{}{}
					for _, id := range []string{bundled.ID, "parity-custom", "parity-online"} {
						repository[id] = map[string]interface{}{"path": "paths/" + id, "type": "path"}
					}
					repository["index-member"] = map[string]interface{}{"path": "guides/recorder-slug", "type": "guide"}
					body, err := json.Marshal(repository)
					if err != nil {
						t.Fatal(err)
					}
					withFetcherOverride(t, func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
						if strings.HasSuffix(rawURL, "repository.json") {
							return body, nil
						}
						if strings.Contains(rawURL, "/paths/") && strings.HasSuffix(rawURL, "/manifest.json") {
							return []byte(`{"type":"path","milestones":["index-member"]}`), nil
						}
						t.Fatalf("unexpected member or external fetch: %s", rawURL)
						return nil, nil
					})
					r := insightsRequest(t, "Admin", "user:1")
					ev := constructor.build(newTestApp(t), r)
					asg := assignmentSpec{TargetType: assignmentTargetPath, TargetID: tc.target, TargetSource: tc.source, AcceptCompletionsFrom: "2026-10-01T00:00:00Z"}
					got, err := ev.assignmentGuides(asg)
					if err != nil || !reflect.DeepEqual(got, tc.want) {
						t.Fatalf("identities = %+v, err = %v; want %+v", got, err, tc.want)
					}
					var rows []completionRecordSpec
					for _, guide := range tc.want {
						rows = append(rows, rec("user:1", guide.GuideSource, guide.GuideID, "Member", "learning-journey", "", "objectives", asg.AcceptCompletionsFrom, 100))
					}
					for i, guide := range tc.want {
						if guide.alternateSource != "" {
							rows[i].GuideSource = guide.alternateSource
						}
					}
					progress := mustGuideProgress(t, ev, asg, rows)
					if !satisfiedFromGuides(progress) {
						t.Fatalf("recorder-shaped rows not satisfied: %+v", progress)
					}
					for i := range rows {
						rows[i].GuideSource = "wrong-repository"
					}
					for _, guide := range mustGuideProgress(t, ev, asg, rows) {
						if guide.Completed {
							t.Fatalf("wrong source counted: %+v", guide)
						}
					}
				})
			}
		})
	}
}
