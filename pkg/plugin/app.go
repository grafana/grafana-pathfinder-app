package plugin

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// tokenExchangeURL is auth-api's token-exchange endpoint. Static in production;
// tests override it to point at a stub server.
var tokenExchangeURL = auth.DefaultTokenExchangeURL

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

	// Mints per-request access tokens for the App Platform proxy routes. Nil
	// when the stack has no on-behalf-of credentials provisioned, in which case
	// those routes report themselves unavailable instead of failing.
	oboExchanger *auth.Exchanger

	// Verifies inbound Grafana ID tokens against the stack's published JWKS.
	// Built lazily (the signing-keys URL comes from the per-request Grafana
	// config, unavailable in NewApp), keyed by app URL, and periodically rebuilt
	// so a key removed from JWKS cannot remain trusted indefinitely.
	idVerifier          *auth.IDTokenVerifier
	idVerifierAppURL    string
	idVerifierCreatedAt time.Time
	idVerifierMu        sync.Mutex

	logger log.Logger
}

// NewApp creates a new App instance.
func NewApp(_ context.Context, appSettings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger.With("plugin", "grafana-pathfinder-app")

	settings, err := ParseSettings(appSettings)
	if err != nil {
		logger.Warn("Failed to parse settings, using defaults", "error", err)
		settings = &Settings{}
	}

	app := &App{
		logger: logger,
	}

	// A stack without provisioned on-behalf-of credentials still loads: the App
	// Platform proxy routes report capability=false and the rest of the plugin
	// is unaffected.
	oboExchanger, err := auth.New(settings.OBOToken, tokenExchangeURL)
	app.oboExchanger = oboExchanger
	if err != nil {
		logger.Warn("On-behalf-of auth setup failed, App Platform proxy routes disabled", "error", err)
	} else if oboExchanger == nil {
		logger.Info("On-behalf-of auth not provisioned, App Platform proxy routes disabled")
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
