package provider

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func TestAssignmentSourceChainParity(t *testing.T) {
	paths, err := services.LoadLocalCatalogue()
	if err != nil {
		t.Fatal(err)
	}
	var bundled services.BundledPath
	for _, path := range paths {
		if len(path.Guides) > 0 {
			bundled = path
			break
		}
	}
	if bundled.ID == "" {
		t.Fatal("no bundled path with inline guides")
	}
	client := contractClient(t, func(*http.Request) any {
		items := []any{}
		for _, id := range []string{bundled.ID, "parity-custom"} {
			items = append(items, map[string]any{"metadata": map[string]any{"name": id}, "spec": map[string]any{"id": id, "title": id, "status": "published", "manifest": map[string]any{"type": "path", "milestones": []string{"custom-member"}}}})
		}
		items = append(items, map[string]any{"metadata": map[string]any{"name": "custom-member"}, "spec": map[string]any{"id": "custom-member", "title": "Member", "status": "published", "manifest": map[string]any{"type": "guide"}}})
		return map[string]any{"items": items}
	})
	store, err := resourceaccess.NewGuideStore(client)
	if err != nil {
		t.Fatal(err)
	}
	online := func(context.Context, string, string, string) ([]services.AssignmentGuideIdentity, bool, error) {
		return []services.AssignmentGuideIdentity{services.OnlineAssignmentGuide("online-member")}, true, nil
	}
	learner := assignmentDependencies(nil, nil, store, online).Evaluator
	insights := insightsEvaluator(store, func() services.PathGuideSource { return online })
	for _, tc := range []struct {
		name, target, source string
		want                 []services.AssignmentGuideIdentity
	}{
		{"OSS bundled", "getting-started", "bundled", services.GuideIdentities([]string{"welcome-to-grafana", "prometheus-grafana-101", "first-dashboard"}, "bundled")},
		{"bundled first", bundled.ID, "", services.GuideIdentities(bundled.Guides, "bundled")},
		{"custom before online", "parity-custom", "", services.GuideIdentities([]string{"custom-member"}, "app-platform")},
		{"qualified custom", bundled.ID, "app-platform", services.GuideIdentities([]string{"custom-member"}, "app-platform")},
		{"online fallback", "parity-online", "", []services.AssignmentGuideIdentity{services.OnlineAssignmentGuide("online-member")}},
		{"qualified online", bundled.ID, "interactive-tutorials", []services.AssignmentGuideIdentity{services.OnlineAssignmentGuide("online-member")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for name, build := range map[string]func(context.Context, string) *services.ObligationEvaluator{"learner": learner, "insights": insights} {
				got, err := build(context.Background(), "default").AssignmentGuides(services.Assignment{TargetType: "path", TargetID: tc.target, TargetSource: tc.source})
				if err != nil || !reflect.DeepEqual(got, tc.want) {
					t.Fatalf("%s: got %+v err %v want %+v", name, got, err, tc.want)
				}
			}
		})
	}
}
