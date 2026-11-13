package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func insightsEvaluator(guides *resourceaccess.GuideStore, online func() services.PathGuideSource) func(context.Context, string) *services.ObligationEvaluator {
	logger := log.DefaultLogger
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return func(ctx context.Context, namespace string) *services.ObligationEvaluator {
		var source services.PathGuideSource
		var loadErr error
		loaded := false
		custom := func(ctx context.Context, target, track, origin string) ([]services.AssignmentGuideIdentity, bool, error) {
			if !loaded {
				loaded = true
				entries, complete, warning := services.DrainInsights(ctx, func(token string) ([]services.CatalogueEntry, string, error) {
					page, err := guides.ListPage(ctx, namespace, token)
					if err != nil {
						return nil, "", err
					}
					entries := []services.CatalogueEntry{}
					for _, raw := range page.Items {
						var object struct {
							Spec json.RawMessage `json:"spec"`
						}
						if err := json.Unmarshal(raw, &object); err != nil {
							return nil, "", err
						}
						if entry, ok := services.DecodeCatalogueEntry(object.Spec, logger.Warn); ok {
							entries = append(entries, entry)
						}
					}
					return entries, page.Continue, nil
				}, func(err error) bool {
					status := sdkErrorStatus(err)
					return status >= 400 && status < 500 && status != 408 && status != 429
				})
				if !complete {
					loadErr = fmt.Errorf("custom catalogue incomplete: %s", warning)
				} else {
					source = services.CustomPathGuides(entries, logger)
				}
			}
			if loadErr != nil {
				return nil, false, loadErr
			}
			return source(ctx, target, track, origin)
		}
		return &services.ObligationEvaluator{Context: ctx, Logger: logger, Sources: []services.PathGuideSource{
			services.BundledPathGuides(logger, services.LoadLocalCatalogue, func(ctx context.Context, url string) ([]string, error) {
				return services.ResolveGuidesFromPathIndex(ctx, url, client)
			}), custom, online(),
		}}
	}
}
