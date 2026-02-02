package plugin

import (
	"context"
	"net/http"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Make sure App implements required interfaces.
var (
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CallResourceHandler   = (*App)(nil)
	_ backend.StreamHandler         = (*App)(nil)
)

// App is the main plugin application struct.
type App struct {
	backend.CallResourceHandler

	// Brokkr client for VM management
	brokkr *BrokkrClient

	// Active terminal sessions (vmID -> session)
	sessions sync.Map

	// Plugin settings
	settings *Settings

	// Logger
	logger log.Logger
}

// NewApp creates a new App instance.
func NewApp(ctx context.Context, appSettings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger.With("plugin", "grafana-pathfinder-app")

	// Parse settings
	settings, err := ParseSettings(appSettings)
	if err != nil {
		logger.Warn("Failed to parse settings, using defaults", "error", err)
		settings = &Settings{}
	}

	app := &App{
		settings: settings,
		logger:   logger,
	}

	// Initialize Brokkr client if configured
	if settings.BrokkrURL != "" {
		app.brokkr = NewBrokkrClient(
			settings.BrokkrURL,
			settings.BrokkrUsername,
			settings.BrokkrPassword,
		)
		logger.Info("Brokkr client initialized", "url", settings.BrokkrURL)
	} else {
		logger.Warn("Brokkr URL not configured, VM features disabled")
	}

	// Set up HTTP routes using httpadapter
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return app, nil
}

// Dispose is called when the plugin is being shut down.
func (a *App) Dispose() {
	a.logger.Info("Disposing plugin instance")

	// Close all active terminal sessions
	a.sessions.Range(func(key, value interface{}) bool {
		if session, ok := value.(*TerminalSession); ok {
			session.Close()
		}
		return true
	})
}

// CheckHealth handles health check requests.
func (a *App) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	// Basic health check
	status := backend.HealthStatusOk
	message := "Plugin is running"

	// Check if Brokkr is configured and reachable
	if a.brokkr == nil {
		status = backend.HealthStatusUnknown
		message = "Brokkr not configured"
	}

	return &backend.CheckHealthResult{
		Status:  status,
		Message: message,
	}, nil
}
