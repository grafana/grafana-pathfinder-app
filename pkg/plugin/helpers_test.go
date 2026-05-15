package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// newTestApp builds a minimal App for tests that only exercise resource
// handlers — no Coda client, no settings, just a logger.
func newTestApp(t *testing.T) *App {
	t.Helper()
	return &App{logger: log.DefaultLogger}
}
