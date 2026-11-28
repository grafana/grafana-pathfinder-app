package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestInsightsMemberSourceAndManifestReads(t *testing.T) {
	ctx := context.Background()
	packages := []OnlinePackage{{ID: "path", Path: "path"}, {ID: "member", Path: "guides/member-slug"}}
	var reads []string
	fetch := func(_ context.Context, path string) (map[string]interface{}, error) {
		reads = append(reads, path)
		return map[string]interface{}{"milestones": []interface{}{"member"}}, nil
	}
	guides, found, err := ResolveOnlinePathGuides(ctx, packages, log.DefaultLogger, "path", "", "interactive-tutorials", fetch)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, []AssignmentGuideIdentity{OnlineAssignmentGuide("member-slug")}, guides)
	_, found, err = ResolveOnlinePathGuides(ctx, packages, log.DefaultLogger, "path", "", "bundled", fetch)
	require.NoError(t, err)
	require.False(t, found)
	require.Equal(t, []string{"path"}, reads)
	custom := CustomPathGuides([]CatalogueEntry{{ID: "path", Status: "published", Manifest: &CatalogueManifest{Type: "path", Milestones: []string{"member"}}}, {ID: "member", Status: "published", Manifest: &CatalogueManifest{Type: "guide", Repository: "online-cdn"}}}, log.DefaultLogger)
	guides, found, err = custom(ctx, "path", "", "app-platform")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, []AssignmentGuideIdentity{{GuideID: "member", GuideSource: "app-platform"}}, guides)
}
