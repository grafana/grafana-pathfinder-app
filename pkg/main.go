package main

import (
	"os"

	"github.com/grafana/grafana-app-sdk/logging"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/provider"
)

func main() {
	// logging.DefaultLogger is a no-op until set; relay app-sdk logs through the plugin logger.
	logging.DefaultLogger = sdkplugin.NewLogger(log.DefaultLogger)

	// Run blocks until Grafana shuts the process down or the plugin exits.
	if err := sdkplugin.Run(
		provider.New(plugin.OnlineAssignmentSource(), plugin.InsightsOnlineAssignmentSource, plugin.ReadRecommendations),
		sdkplugin.WithPluginID("grafana-pathfinder-app"),
		sdkplugin.WithAppFunc(plugin.NewApp),
	); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}
