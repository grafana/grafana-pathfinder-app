package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func assignmentDependencies(assignments *resourceaccess.AssignmentStore, completions *resourceaccess.CompletionStore, guides *resourceaccess.GuideStore, online services.PathGuideSource) assignmentRouteDependencies {
	limiter := services.NewUserRateLimiter(20, 1, time.Now)
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	logger := log.DefaultLogger
	return assignmentRouteDependencies{
		Assignments:     assignments,
		ReadCompletions: completions.ReadCaller,
		Allow: func(namespace, subject string) (bool, time.Duration) {
			return limiter.Allow(namespace + "\x00" + subject)
		},
		Evaluator: func(ctx context.Context, namespace string) *services.ObligationEvaluator {
			var source services.PathGuideSource
			var loadErr error
			loaded := false
			custom := func(ctx context.Context, target, track, origin string) ([]services.AssignmentGuideIdentity, bool, error) {
				if !loaded {
					loaded = true
					readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
					defer cancel()
					entries, _, err := services.ReadCatalogue(readCtx, namespace, 50000, func(ctx context.Context, namespace, token string) (services.CataloguePage[services.CatalogueEntry], error) {
						raw, err := guides.ListPage(ctx, namespace, token)
						if err != nil {
							return services.CataloguePage[services.CatalogueEntry]{}, err
						}
						page := services.CataloguePage[services.CatalogueEntry]{Continue: raw.Continue}
						for _, item := range raw.Items {
							var object struct {
								Spec json.RawMessage `json:"spec"`
							}
							if err := json.Unmarshal(item, &object); err != nil {
								return page, err
							}
							if entry, ok := services.DecodeCatalogueEntry(object.Spec, logger.Warn); ok {
								page.Entries = append(page.Entries, entry)
							}
						}
						return page, nil
					}, func(pages int) {
						logger.Warn("custom guide catalogue LIST truncated at aggregate budget", "namespace", namespace, "pages", pages)
					})
					loadErr = err
					source = services.CustomPathGuides(entries, logger)
				}
				if loadErr != nil {
					return nil, false, loadErr
				}
				return source(ctx, target, track, origin)
			}
			return &services.ObligationEvaluator{Context: ctx, Logger: logger, Sources: []services.PathGuideSource{
				services.BundledPathGuides(logger, services.LoadLocalCatalogue, func(ctx context.Context, url string) ([]string, error) {
					return services.ResolveGuidesFromPathIndex(ctx, url, client)
				}), custom, online,
			}}
		},
		MarkSatisfied: func(ctx context.Context, namespace string, records []services.Assignment) {
			if len(records) == 0 {
				return
			}
			go func() {
				defer func() {
					if value := recover(); value != nil {
						logger.Error("assignment status write panicked", "panic", value)
					}
				}()
				ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
				defer cancel()
				for _, record := range records {
					if err := assignments.MarkSatisfied(ctx, namespace, record); err != nil {
						logger.Info("assignment status write failed", "name", record.Name, "error", err)
					}
				}
			}()
		},
	}
}
