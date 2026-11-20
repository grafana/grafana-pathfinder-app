package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Source qualification prevents same-slug guides in other repositories from granting credit.
type assignmentGuideIdentity = services.AssignmentGuideIdentity

func assignmentGuideMatchesCompletion(guide assignmentGuideIdentity, rec completionRecordSpec) bool {
	return services.AssignmentGuideMatchesCompletion(guide, rec)
}
func publicTutorialSource(source string) bool { return services.PublicTutorialSource(source) }
func onlineAssignmentGuide(id string) assignmentGuideIdentity {
	return services.OnlineAssignmentGuide(id)
}

// A found target with no guides is unresolved; an error must never mean outstanding.
type pathGuideSource = services.PathGuideSource

const pathIndexTimeout = 10 * time.Second

type bundledPath = services.BundledPath

var pathIndexFetch = resolveGuidesFromPathIndex

var pathIndexClient = &http.Client{
	Timeout: pathIndexTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func bundledPathGuides(logger log.Logger) pathGuideSource {
	return services.BundledPathGuides(logger, loadLocalCatalogue, pathIndexFetch)
}
func guideIdentities(ids []string, source string) []assignmentGuideIdentity {
	return services.GuideIdentities(ids, source)
}
func customPathGuides(entries []customGuideRepositoryEntry, logger log.Logger) pathGuideSource {
	return services.CustomPathGuides(entries, logger)
}

func (a *App) onlinePathGuides(logger log.Logger) pathGuideSource {
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
		if targetSource != "" && !onlineAssignmentGuide(targetID).MatchesSource(targetSource) {
			return nil, false, nil
		}
		resp, err := a.getCachedPackageRecommendations(ctx)
		if err != nil {
			return nil, false, err
		}
		return a.resolveOnlinePathGuides(ctx, resp, logger, targetID, trackID, targetSource)
	}
}

func onlinePackages(resp *PackageRecommendationsResponse) []services.OnlinePackage {
	entries := make([]services.OnlinePackage, len(resp.Packages))
	for i, entry := range resp.Packages {
		entries[i] = services.OnlinePackage{ID: entry.ID, Path: entry.Path, Manifest: entry.Manifest}
	}
	return entries
}

func (a *App) resolveOnlinePathGuides(ctx context.Context, resp *PackageRecommendationsResponse, logger log.Logger, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
	return services.ResolveOnlinePathGuides(ctx, onlinePackages(resp), logger, targetID, trackID, targetSource, func(ctx context.Context, path string) (map[string]interface{}, error) {
		manifestURL := buildPackageFileURL(resp.BaseURL, path, "manifest.json")
		if manifestURL == "" || !isAllowedInteractiveLearningHost(manifestURL) {
			return nil, nil
		}
		fetch := packageRepositoryFetcherOverride
		if fetch == nil {
			fetch = defaultPackageRepositoryFetcher
		}
		body, err := fetch(ctx, manifestURL, packageManifestMaxBytes)
		if err != nil {
			return nil, err
		}
		var manifest map[string]interface{}
		if err := json.Unmarshal(body, &manifest); err != nil {
			return nil, fmt.Errorf("parse manifest: %w", err)
		}
		return manifest, nil
	})
}

func (a *App) resolveOnlineGuideIdentities(_ context.Context, resp *PackageRecommendationsResponse, ids []interface{}) ([]assignmentGuideIdentity, error) {
	return services.ResolveOnlineGuideIdentities(onlinePackages(resp), ids)
}

// loadLocalCatalogue decodes the embedded paths-cloud.json once per process.
func loadLocalCatalogue() ([]bundledPath, error) { return services.LoadLocalCatalogue() }

// resolveGuidesFromPathIndex reads a public docs site's index.json the way
// fetch-path-guides.ts does: skip params.grafana.skip, guide id is the permalink slug.
func resolveGuidesFromPathIndex(ctx context.Context, pathURL string) ([]string, error) {
	return services.ResolveGuidesFromPathIndex(ctx, pathURL, pathIndexClient)
}

// resolveMilestoneGuideID translates a manifest milestone id into the guide id
// its completion record carries: the last segment of the sibling index entry's
// path, which differs from the canonical id when the CDN uses templated slugs.
// Falls back to the milestone id when it has no entry of its own.
func resolveMilestoneGuideID(packages []PackageEntry, milestoneID string) string {
	for i := range packages {
		if packages[i].ID != milestoneID {
			continue
		}
		if slug := lastPathSegment(packages[i].Path); slug != "" {
			return slug
		}
		break
	}
	return milestoneID
}

func lastPathSegment(p string) string {
	trimmed := strings.Trim(p, "/")
	return trimmed[strings.LastIndex(trimmed, "/")+1:]
}

func OnlineAssignmentSource() services.PathGuideSource {
	return (&App{}).onlinePathGuides(log.DefaultLogger)
}
