package main

import (
	"os"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin"
	"github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func main() {
	// Start listening to requests sent from Grafana.
	if err := app.Manage("grafana-pathfinder-app", plugin.NewApp, app.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("Failed to start plugin", "error", err)
		os.Exit(1)
	}
}
