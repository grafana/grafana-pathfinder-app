package publiccontent

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func onlinePathGuides(logger log.Logger) services.PathGuideSource {
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]services.AssignmentGuideIdentity, bool, error) {
		if targetSource != "" && !services.OnlineAssignmentGuide(targetID).MatchesSource(targetSource) {
			return nil, false, nil
		}
		resp, err := getCachedPackageRecommendations(ctx)
		if err != nil {
			return nil, false, err
		}
		return resolveOnlinePathGuides(ctx, resp, logger, targetID, trackID, targetSource)
	}
}

func onlinePackages(resp *PackageRecommendationsResponse) []services.OnlinePackage {
	entries := make([]services.OnlinePackage, len(resp.Packages))
	for i, entry := range resp.Packages {
		entries[i] = services.OnlinePackage{ID: entry.ID, Path: entry.Path, Manifest: entry.Manifest}
	}
	return entries
}

func resolveOnlinePathGuides(ctx context.Context, resp *PackageRecommendationsResponse, logger log.Logger, targetID, trackID, targetSource string) ([]services.AssignmentGuideIdentity, bool, error) {
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

func OnlineAssignmentSource() services.PathGuideSource {
	return onlinePathGuides(log.DefaultLogger)
}

func InsightsOnlineAssignmentSource() services.PathGuideSource {
	logger := log.DefaultLogger
	var online *PackageRecommendationsResponse
	var onlineErr error
	onlineLoaded := false
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]services.AssignmentGuideIdentity, bool, error) {
		if targetSource != "" && !services.OnlineAssignmentGuide(targetID).MatchesSource(targetSource) {
			return nil, false, nil
		}
		if !onlineLoaded {
			onlineLoaded = true
			var partial bool
			online, partial, onlineErr = fetchAndParsePackageRepository(ctx, packageRepositoryURL)
			if partial && onlineErr == nil {
				onlineErr = fmt.Errorf("online catalogue incomplete")
			}
		}
		if onlineErr != nil {
			return nil, false, onlineErr
		}
		return resolveOnlinePathGuides(ctx, online, logger, targetID, trackID, targetSource)
	}
}
