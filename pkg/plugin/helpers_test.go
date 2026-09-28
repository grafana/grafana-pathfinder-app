package plugin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// TestMain points the auth-api JWKS endpoint at an origin nothing listens on, so
// no test reaches the real one and the default identity fixtures model a stack
// that publishes its own signing keys (self-hosted Grafana). Tests for the
// Grafana Cloud shape, where auth-api holds the key instead, opt in with
// withSigningKeysURL.
func TestMain(m *testing.M) {
	unreachable := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	unreachable.Close()
	signingKeysURL = unreachable.URL + "/v1/keys"
	os.Exit(m.Run())
}

// withSigningKeysURL points the auth-api JWKS endpoint at a stub for one test.
func withSigningKeysURL(t *testing.T, keysURL string) {
	t.Helper()
	previous := signingKeysURL
	signingKeysURL = keysURL
	t.Cleanup(func() { signingKeysURL = previous })
}

// newTestApp builds a minimal App for tests that only exercise resource
// handlers — no Coda client, no settings, just a logger. It has NO on-behalf-of
// exchanger, which models an unprovisioned stack; tests that need the App
// Platform proxies to resolve a real client use newTestAppWithOBO.
func newTestApp(t *testing.T) *App {
	t.Helper()
	return &App{logger: log.DefaultLogger}
}

// capturingLogger records every log line's level and message so a test can
// assert that a decision was made loudly enough to reach Faro (which surfaces
// warn and above), not just that the HTTP status was right.
type capturingLogger struct {
	lines *[]capturedLine
}

type capturedLine struct {
	level string
	msg   string
}

func newCapturingLogger() capturingLogger {
	return capturingLogger{lines: &[]capturedLine{}}
}

func (l capturingLogger) record(level, msg string) {
	*l.lines = append(*l.lines, capturedLine{level: level, msg: msg})
}

// warnedWith reports whether any captured warn line's message contains substr.
func (l capturingLogger) warnedWith(substr string) bool {
	for _, line := range *l.lines {
		if line.level == "warn" && strings.Contains(line.msg, substr) {
			return true
		}
	}
	return false
}

func (l capturingLogger) Debug(msg string, _ ...interface{}) { l.record("debug", msg) }
func (l capturingLogger) Info(msg string, _ ...interface{})  { l.record("info", msg) }
func (l capturingLogger) Warn(msg string, _ ...interface{})  { l.record("warn", msg) }
func (l capturingLogger) Error(msg string, _ ...interface{}) { l.record("error", msg) }
func (l capturingLogger) With(_ ...interface{}) log.Logger   { return l }
func (l capturingLogger) Level() log.Level                   { return log.Debug }
func (l capturingLogger) FromContext(_ context.Context) log.Logger {
	return l
}

// newTestAppWithOBO builds a test App that looks provisioned: it carries a real
// auth.Exchanger so the App Platform resolvers get past their nil-exchanger
// guard. Nothing here talks to auth-api — building the exchanger is offline, and
// the resolvers under test never mint.
func newTestAppWithOBO(t *testing.T) *App {
	t.Helper()
	app := newTestApp(t)
	ex, err := auth.New("test-cap-token", auth.DefaultTokenExchangeURL)
	if err != nil {
		t.Fatalf("building test exchanger: %v", err)
	}
	app.oboExchanger = ex
	return app
}
