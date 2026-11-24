package plugin

import (
	"context"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"net/http"
)

func (a *App) insightsObligationEvaluator(r *http.Request) *obligationEvaluator {
	logger := a.ctxLogger(r.Context())
	ev := &obligationEvaluator{Context: r.Context(), Logger: logger}
	var custom pathGuideSource
	var customErr error
	customLoaded := false
	customSource := func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
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
		return custom(ctx, targetID, trackID, targetSource)
	}
	onlineSource := InsightsOnlineAssignmentSource()

	ev.Sources = []pathGuideSource{bundledPathGuides(logger), customSource, onlineSource}
	return ev
}

func InsightsOnlineAssignmentSource() services.PathGuideSource {
	logger := log.DefaultLogger
	var online *PackageRecommendationsResponse
	var onlineErr error
	onlineLoaded := false
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
		if targetSource != "" && !onlineAssignmentGuide(targetID).MatchesSource(targetSource) {
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
		return (&App{}).resolveOnlinePathGuides(ctx, online, logger, targetID, trackID, targetSource)
	}
}
