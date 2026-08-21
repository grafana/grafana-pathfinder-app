package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"
)

// Pin the literal .app group and its derived toggle so a silent drift (wrong
// transform, or accidentally reusing the legacy .com gate) is caught: it would
// otherwise fail closed as a 404/capability=false while every test that enables
// both toggles stayed green.
//
// This pins NAMES, not availability. A real stack reports both aggregation
// toggles true at once, so the toggle is a precondition — "an aggregation layer
// is served" — and never the answer to "is this route usable here?". That answer
// comes from the capability/resolver path, which TestCompletionRoute_GatesOnAppToggleOnly
// and TestCompletionWriteRoute_UnprovisionedStackIsStructurallyUnavailable exercise.
func TestCompletionRoute_AppGroupToggleLiterals(t *testing.T) {
	if appPlatformGroup != "pathfinderbackend.ext.grafana.app" {
		t.Errorf("appPlatformGroup = %q, want the .app group", appPlatformGroup)
	}
	if completionRecordsGroupVersion != "pathfinderbackend.ext.grafana.app/v1alpha1" {
		t.Errorf("completionRecordsGroupVersion = %q", completionRecordsGroupVersion)
	}
	if completionRecordsAggregationToggle != "aggregation.pathfinderbackend-ext-grafana-app.enabled" {
		t.Errorf("completionRecordsAggregationToggle = %q, want the .app toggle", completionRecordsAggregationToggle)
	}
	// The legacy .com toggle is a different string; the derivation must never
	// collapse onto it (which is how a rename would silently move the gate).
	if completionRecordsAggregationToggle == pathfinderBackendAggregationToggle {
		t.Errorf("completion toggle must differ from the legacy .com toggle %q", pathfinderBackendAggregationToggle)
	}
	if pathfinderBackendAggregationToggle != "aggregation.pathfinderbackend-ext-grafana-com.enabled" {
		t.Errorf("pathfinderBackendAggregationToggle = %q, want the legacy .com toggle", pathfinderBackendAggregationToggle)
	}
}

// Completion read, capability, and write resolution must key on the .app toggle
// ALONE: available with only .app enabled, unavailable with only the legacy .com
// toggle enabled (completion data lives only on the .app group).
func TestCompletionRoute_GatesOnAppToggleOnly(t *testing.T) {
	appOnly := map[string]string{
		featuretoggles.EnabledFeatures: completionRecordsAggregationToggle,
		sdkconfig.AppURL:               "http://grafana.example",
	}
	comOnly := map[string]string{
		featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle,
		sdkconfig.AppURL:               "http://grafana.example",
	}
	app := newTestAppWithOBO(t)

	newReq := func(cfg map[string]string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "/completion-records/my", nil)
		ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
		ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
		return r.WithContext(ctx)
	}

	t.Run("read resolves on .app only", func(t *testing.T) {
		if _, _, available, _ := app.resolveCompletionBackend(newReq(appOnly)); !available {
			t.Error("read backend must be available with the .app toggle")
		}
		if _, _, available, _ := app.resolveCompletionBackend(newReq(comOnly)); available {
			t.Error("read backend must be UNavailable with only the legacy .com toggle")
		}
	})

	t.Run("write resolves on .app only", func(t *testing.T) {
		if _, _, available, _ := app.resolveCompletionWriteBackend(newReq(appOnly)); !available {
			t.Error("write backend must be available with the .app toggle")
		}
		if _, _, available, _ := app.resolveCompletionWriteBackend(newReq(comOnly)); available {
			t.Error("write backend must be UNavailable with only the legacy .com toggle")
		}
	})
}

// The write resolver introduced by this PR does NOT inherit the read resolver's
// nil-exchanger guard for free — it is a separate function, and a missing guard
// there means an unprovisioned stack builds a real client with no credential and
// hard-fails instead of degrading. Ops and prod have no credential provisioned
// today (#1503), so this is the live production path, not a corner case: it must
// resolve structurally unavailable with reasonOBOUnavailable, which the handler
// maps to the 404 the front end treats as a session disarm that keeps its facts.
func TestCompletionWriteRoute_UnprovisionedStackIsStructurallyUnavailable(t *testing.T) {
	healthyCfg := map[string]string{
		featuretoggles.EnabledFeatures: completionRecordsAggregationToggle,
		sdkconfig.AppURL:               "http://grafana.example",
	}
	newReq := func() *http.Request {
		r, _ := http.NewRequest(http.MethodPost, "/completion-records", nil)
		ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
		ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(healthyCfg))
		return r.WithContext(ctx)
	}

	t.Run("no exchanger provisioned", func(t *testing.T) {
		app := newTestApp(t) // no oboExchanger — an unprovisioned stack
		creator, _, available, reason := app.resolveCompletionWriteBackend(newReq())
		if available {
			t.Fatal("write backend must be structurally unavailable without a provisioned credential")
		}
		if reason != reasonOBOUnavailable {
			t.Errorf("reason = %q, want %q", reason, reasonOBOUnavailable)
		}
		if creator != nil {
			t.Error("no creator may be returned without a credential")
		}
	})

	t.Run("exchanger provisioned", func(t *testing.T) {
		if _, _, available, reason := newTestAppWithOBO(t).resolveCompletionWriteBackend(newReq()); !available {
			t.Errorf("write backend must be available once provisioned, got unavailable (%q)", reason)
		}
	})
}

// The handler's end of the same contract: an unprovisioned stack returns the
// structural 404 (with the obo-unavailable reason in the envelope), not a 5xx
// and not a silent success.
func TestCompletionWriteHandler_UnprovisionedStackReturns404(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	app := newTestApp(t) // no oboExchanger

	r := writeRequest(t, "user:27", validWriteBody(), testGrafanaConfig())
	rec := httptest.NewRecorder()
	app.handleCreateCompletionRecord(rec, r)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (structural disarm)", rec.Code)
	}
	var envelope struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding response: %v (body: %s)", err, rec.Body.String())
	}
	if envelope.Error != reasonOBOUnavailable {
		t.Errorf("error = %q, want %q", envelope.Error, reasonOBOUnavailable)
	}
}

// registerRoutes must wire POST /completion-records to the create handler. A
// route typo would surface to #1434 as the reserved structural 404 (disarming
// the session) while the direct-handler write tests stayed green, so exercise
// the mux: an unsupported method reaches the handler and returns 405 (not a
// route 404), and a POST reaches it (401 without identity, not a route 404).
func TestCompletionRoute_MuxWiring(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	app := newTestApp(t)
	mux := http.NewServeMux()
	app.registerRoutes(mux)

	t.Run("GET on create route is 405, not route 404", func(t *testing.T) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/completion-records", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want 405 (handler reached, wrong method)", rec.Code)
		}
	})

	t.Run("POST reaches the handler", func(t *testing.T) {
		rec := httptest.NewRecorder()
		// No identity → the handler's own 401, proving the route reached the
		// handler rather than missing (a missing route is a bare 404).
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/completion-records", bytes.NewReader([]byte(`{}`))))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401 (handler reached, unauthenticated)", rec.Code)
		}
	})
}

// A production App (NewApp) must carry the completion write rate limiter; the
// ordinary handler tests use a nil-limiter App, so nothing else proves the real
// constructor wires it.
func TestNewApp_ConstructsCompletionWriteRateLimiter(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("NewApp: %v", err)
	}
	app, ok := inst.(*App)
	if !ok {
		t.Fatalf("NewApp returned %T, want *App", inst)
	}
	if app.completionWriteRateLimiter == nil {
		t.Fatal("production App must have a completionWriteRateLimiter")
	}
}
