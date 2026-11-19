package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"

	achievementawardv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/achievementaward/v1alpha1"
	achievementprogressv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/achievementprogress/v1alpha1"
	assignmentv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/assignment/v1alpha1"
	completionrecordv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/completionrecord/v1alpha1"
	interactiveguidev1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/interactiveguide/v1alpha1"
	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
	pathfindersettingsv1alpha1 "github.com/grafana/grafana-pathfinder-app/pkg/generated/pathfindersettings/v1alpha1"
)

// New returns the app.Provider that main.go hands to the app-sdk plugin runner.
func New(online services.PathGuideSource, insightsOnline func() services.PathGuideSource, recommendations services.RecommendationsReader, definitions ...AchievementDefinitions) app.Provider {
	return simple.NewAppProvider(manifestdata.LocalManifest(), nil, func(cfg app.Config) (app.App, error) {
		return newApp(cfg, online, insightsOnline, recommendations, definitions...)
	})
}

func newApp(cfg app.Config, online services.PathGuideSource, insightsOnline func() services.PathGuideSource, recommendations services.RecommendationsReader, definitions ...AchievementDefinitions) (app.App, error) {
	store, err := resourceaccess.NewSettingsStore(sdkplugin.BuildClientGenerator(resourceaccess.SettingsConfig(cfg.KubeConfig)))
	if err != nil {
		return nil, err
	}
	guides, err := resourceaccess.NewGuideStore(sdkplugin.BuildClientGenerator(resourceaccess.BoundedConfig(cfg.KubeConfig, resourceaccess.GuidePageMaxBytes)))
	if err != nil {
		return nil, err
	}
	completions, err := resourceaccess.NewCompletionStore(sdkplugin.BuildClientGenerator(resourceaccess.BoundedConfig(cfg.KubeConfig, 8*1024*1024)))
	if err != nil {
		return nil, err
	}
	assignments, err := resourceaccess.NewAssignmentStore(sdkplugin.BuildClientGenerator(resourceaccess.BoundedConfig(cfg.KubeConfig, 8*1024*1024)))
	if err != nil {
		return nil, err
	}
	writer, err := resourceaccess.NewCompletionWriter(sdkplugin.BuildClientGenerator(resourceaccess.BoundedConfig(cfg.KubeConfig, resourceaccess.CompletionWriteMaxBytes)))
	if err != nil {
		return nil, err
	}
	achievementClients, err := resourceaccess.NewAchievementClients(sdkplugin.BuildClientGenerator(resourceaccess.AchievementConfig(cfg.KubeConfig)))
	if err != nil {
		return nil, err
	}
	var achievementDefinitions AchievementDefinitions
	if len(definitions) > 0 {
		achievementDefinitions = definitions[0]
	}
	assignmentDeps := assignmentDependencies(assignments, completions, guides, online)
	config := simple.AppConfig{
		Name:       "pathfinder-backend",
		KubeConfig: cfg.KubeConfig,
		VersionedCustomRoutes: map[string]simple.AppVersionRouteHandlers{
			"v1alpha1": {
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/api/v1/achievements/events", Method: simple.AppCustomRouteMethodPost}:     achievementHandler(achievementClients, achievementDefinitions, "events"),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/api/v1/achievements/my", Method: simple.AppCustomRouteMethodGet}:          achievementHandler(achievementClients, achievementDefinitions, "my"),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/api/v1/achievements/definitions", Method: simple.AppCustomRouteMethodGet}: achievementHandler(achievementClients, achievementDefinitions, "definitions"),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/package-recommendations", Method: simple.AppCustomRouteMethodGet}:         recommendationsHandler(recommendations),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/health", Method: simple.AppCustomRouteMethodGet}:                          healthHandler,
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/custom-guide", Method: simple.AppCustomRouteMethodPost}:                   resourceWriteHandler("InteractiveGuide", resourceaccess.GuidePageMaxBytes, guides.Write, guides.Delete),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/custom-guide", Method: simple.AppCustomRouteMethodPut}:                    resourceWriteHandler("InteractiveGuide", resourceaccess.GuidePageMaxBytes, guides.Write, guides.Delete),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/custom-guide", Method: simple.AppCustomRouteMethodDelete}:                 resourceWriteHandler("InteractiveGuide", resourceaccess.GuidePageMaxBytes, guides.Write, guides.Delete),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/pathfinder-settings", Method: simple.AppCustomRouteMethodPost}:            resourceWriteHandler("PathfinderSettings", services.SettingsMaxBytes, store.Write, nil),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/pathfinder-settings", Method: simple.AppCustomRouteMethodPut}:             resourceWriteHandler("PathfinderSettings", services.SettingsMaxBytes, store.Write, nil),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/completion-records", Method: simple.AppCustomRouteMethodPost}:             completionWriteHandler(writer, completionAssignmentSync(assignments, completions, assignmentDeps.Evaluator)),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/learning-insights", Method: simple.AppCustomRouteMethodGet}:               insightsReadHandler(completions, assignments, insightsEvaluator(guides, insightsOnline), assignmentDeps.Allow),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/assignments/my", Method: simple.AppCustomRouteMethodGet}:                  assignmentsReadHandler(assignmentDeps),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/completion-records/my", Method: simple.AppCustomRouteMethodGet}:           completionReadHandler(completions, false),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/completion-records/capability", Method: simple.AppCustomRouteMethodGet}:   completionReadHandler(completions, true),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/custom-guide-repository", Method: simple.AppCustomRouteMethodGet}:         catalogueReadHandler(guides),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/custom-guide", Method: simple.AppCustomRouteMethodGet}:                    guideReadHandler(guides),
				simple.AppVersionRoute{Namespaced: true, Path: "/backend/pathfinder-settings", Method: simple.AppCustomRouteMethodGet}:             settingsReadHandler(store.Read),
			},
		},
		ManagedKinds: []simple.AppManagedKind{
			{Kind: achievementawardv1alpha1.Kind()},
			{Kind: achievementprogressv1alpha1.Kind()},
			{Kind: interactiveguidev1alpha1.Kind()},
			{Kind: completionrecordv1alpha1.Kind()},
			{Kind: pathfindersettingsv1alpha1.Kind()},
			{Kind: assignmentv1alpha1.Kind()},
		},
	}
	// The SDK supplies either its caller-exchange transport, a deprecated shared bearer, or an empty configuration.
	if cfg.KubeConfig.Host == "" || cfg.KubeConfig.BearerToken != "" || cfg.KubeConfig.WrapTransport == nil {
		for route := range config.VersionedCustomRoutes["v1alpha1"] {
			switch route.Path {
			case "/backend/package-recommendations", "/backend/api/v1/achievements/definitions":
			default:
				config.VersionedCustomRoutes["v1alpha1"][route] = unavailableTenantRoute
			}
		}
	}
	return simple.NewApp(config)
}

func unavailableTenantRoute(_ context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	switch strings.TrimPrefix(req.Path, "/") {
	case "backend/completion-records":
		w.WriteHeader(http.StatusNotFound)
	case "backend/completion-records/my":
		return json.NewEncoder(w).Encode(services.CompletionResponse{Capability: services.CompletionCapability{Reason: "obo-unavailable"}, Completions: []services.CollatedCompletion{}, InProgress: []services.InProgressCompletion{}})
	case "backend/completion-records/capability":
		return json.NewEncoder(w).Encode(services.CompletionCapability{Reason: "obo-unavailable"})
	default:
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	return json.NewEncoder(w).Encode(map[string]string{"error": "obo-unavailable"})
}
