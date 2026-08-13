package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// newTestApp builds a minimal App for tests that only exercise resource
// handlers — no Coda client, no settings, just a logger and a fresh identity
// verifier (real signature verification against whatever JWKS server the
// test's Grafana config app URL points to; see testJWKSServerURL).
func newTestApp(t *testing.T) *App {
	t.Helper()
	return &App{logger: log.DefaultLogger, identityVerifier: auth.NewIdentityVerifier()}
}
