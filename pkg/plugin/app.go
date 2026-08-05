package plugin

import (
	"context"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Make sure App implements required interfaces.
var (
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CallResourceHandler   = (*App)(nil)
)

// App is the main plugin application struct. The backend is a read proxy for the
// App Platform aggregator; sandbox VMs and terminals live in the separate
// grafana-coda-app plugin.
type App struct {
	backend.CallResourceHandler

	logger log.Logger
}

// NewApp creates a new App instance.
func NewApp(_ context.Context, _ backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	app := &App{
		logger: log.DefaultLogger.With("plugin", "grafana-pathfinder-app"),
	}

	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return app, nil
}

// Dispose is called when the plugin is being shut down.
func (a *App) Dispose() {
	a.logger.Info("Disposing plugin instance")
}

// ctxLogger returns a contextual logger that automatically includes traceID,
// endpoint, pluginID, and other metadata from the context for better debugging.
func (a *App) ctxLogger(ctx context.Context) log.Logger {
	return a.logger.FromContext(ctx)
}

// CheckHealth handles health check requests.
func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Plugin is running",
	}, nil
}
