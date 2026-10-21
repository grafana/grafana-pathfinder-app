package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

func (a *App) insightsObligationEvaluator(r *http.Request) *obligationEvaluator {
	logger := a.ctxLogger(r.Context())
	ev := &obligationEvaluator{ctx: r.Context(), logger: logger}
	var custom pathGuideSource
	var customErr error
	customLoaded := false
	customSource := func(ctx context.Context, targetID, trackID string) ([]string, bool, error) {
		if !customLoaded {
			customLoaded = true
			lister, namespace, available, reason := a.resolveCustomGuideBackend(r)
			if !available {
				customErr = fmt.Errorf("custom catalogue unavailable: %s", reason)
			} else {
				entries, complete, warning := drainInsights(ctx, func(token string) ([]customGuideRepositoryEntry, string, error) {
					page, err := lister.ListPage(ctx, namespace, token)
					if err != nil {
						return nil, "", err
					}
					return page.Entries, page.Continue, nil
				})
				if !complete {
					customErr = fmt.Errorf("custom catalogue incomplete: %s", warning)
				}
				if customErr == nil {
					custom = customPathGuides(entries, logger)
				}
			}
		}
		if customErr != nil {
			return nil, false, customErr
		}
		return custom(ctx, targetID, trackID)
	}
	var online *PackageRecommendationsResponse
	var onlineErr error
	onlineLoaded := false
	onlineSource := func(ctx context.Context, targetID, trackID string) ([]string, bool, error) {
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
		for _, entry := range online.Packages {
			if entry.ID != targetID {
				continue
			}
			manifest := entry.Manifest
			if manifest == nil {
				endpoint := buildPackageFileURL(online.BaseURL, entry.Path, "manifest.json")
				if endpoint == "" || !isAllowedInteractiveLearningHost(endpoint) {
					return nil, true, nil
				}
				fetch := packageRepositoryFetcherOverride
				if fetch == nil {
					fetch = defaultPackageRepositoryFetcher
				}
				body, err := fetch(ctx, endpoint, packageManifestMaxBytes)
				if err != nil {
					return nil, true, err
				}
				if err := json.Unmarshal(body, &manifest); err != nil {
					return nil, true, err
				}
			}
			ids, _ := manifest["milestones"].([]interface{})
			if trackID != "" {
				var ok bool
				if ids, ok = manifestTrackGuides(manifest, trackID); !ok {
					return nil, true, nil
				}
			}
			return resolveGuideIDs(online.Packages, ids), true, nil
		}
		return nil, false, nil
	}
	ev.sources = []pathGuideSource{bundledPathGuides(logger), customSource, onlineSource}
	return ev
}
