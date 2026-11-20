package main

import (
	"os"

	"github.com/grafana/grafana-app-sdk/logging"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
	"github.com/grafana/grafana-pathfinder-app/pkg/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/provider"
	"github.com/grafana/grafana-pathfinder-app/pkg/sdkingress"
)

func main() {
	// logging.DefaultLogger is a no-op until set; relay app-sdk logs through the plugin logger.
	logging.DefaultLogger = sdkplugin.NewLogger(log.DefaultLogger)

	const pluginID = "grafana-pathfinder-app"
	auth, err := sdkingress.FromEnvironment(pluginID, manifestdata.LocalManifest().ManifestData.Group)
	if err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
	if err := sdkplugin.Run(
		provider.New(plugin.OnlineAssignmentSource(), plugin.InsightsOnlineAssignmentSource, plugin.ReadRecommendations, plugin.AchievementDefinitions()),
		sdkplugin.WithPluginID(pluginID),
		sdkplugin.WithAuthenticator(auth),
		sdkplugin.WithAppFunc(plugin.NewApp),
	); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}
