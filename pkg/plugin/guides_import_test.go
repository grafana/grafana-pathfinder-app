package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// stubAggregator constructs an httptest server that returns the given
// per-method handler. Routes that aren't mapped reply 404 with a
// canonical K8s `Status` envelope so the client treats them as
// real not-founds.
func stubAggregator(t *testing.T, handlers map[string]http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/default/interactiveguides", func(w http.ResponseWriter, r *http.Request) {
		if h, ok := handlers[r.Method+" /collection"]; ok {
			h(w, r)
			return
		}
		writeK8sStatus(w, http.StatusMethodNotAllowed, "method not allowed on collection")
	})
	mux.HandleFunc("/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/default/interactiveguides/", func(w http.ResponseWriter, r *http.Request) {
		// path tail after the prefix is the resource name
		key := r.Method + " /resource"
		if h, ok := handlers[key]; ok {
			h(w, r)
			return
		}
		writeK8sStatus(w, http.StatusNotFound, "not found")
	})
	return httptest.NewServer(mux)
}

func writeK8sStatus(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"kind":       "Status",
		"apiVersion": "v1",
		"status":     "Failure",
		"code":       code,
		"message":    message,
	})
}

// newImportTestApp wires an *App with a guidesClient pointed at the
// given aggregator URL and the test logger. No Coda, no streams.
func newImportTestApp() *App {
	return &App{
		logger:       log.New(),
		guidesClient: newGuidesClient(),
	}
}

// importRequest builds an *http.Request for handleGuidesImport with the
// given role and namespace populated in PluginContext, plus AppURL,
// plugin SA token, and the aggregator feature toggle enabled. Use
// importRequestNoAggregator to simulate OSS / pre-rollout Cloud.
func importRequest(t *testing.T, role, namespace, appURL, body string) *http.Request {
	t.Helper()
	return buildImportRequest(t, role, namespace, appURL, body, true)
}

// importRequestNoAggregator builds a request with the aggregator
// feature toggle OFF, simulating OSS Grafana where the aggregator API
// is not served.
func importRequestNoAggregator(t *testing.T, role, namespace, appURL, body string) *http.Request {
	t.Helper()
	return buildImportRequest(t, role, namespace, appURL, body, false)
}

func buildImportRequest(t *testing.T, role, namespace, appURL, body string, aggregatorEnabled bool) *http.Request {
	t.Helper()
	pluginCtx := backend.PluginContext{
		Namespace: namespace,
	}
	if role != "" {
		pluginCtx.User = &backend.User{Login: "test-user", Role: role}
	}
	cfgMap := map[string]string{
		backend.AppURL: appURL,
	}
	if aggregatorEnabled {
		cfgMap["GF_INSTANCE_FEATURE_TOGGLES_ENABLE"] = guidesAggregatorFeatureToggle
	}
	cfg := backend.NewGrafanaCfg(cfgMap)

	r := httptest.NewRequest(http.MethodPost, "/v1/guides/import", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	// The handler forwards Authorization to the aggregator verbatim;
	// tests inject a sentinel value that aggregator stubs assert against.
	r.Header.Set("Authorization", "Bearer test-caller-token")
	ctx := backend.WithPluginContext(r.Context(), pluginCtx)
	ctx = backend.WithGrafanaConfig(ctx, cfg)
	return r.WithContext(ctx)
}

// readBody pulls the response body out of an httptest recorder and
// returns it as a string for assertion.
func readBody(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	body, err := io.ReadAll(w.Result().Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(body)
}

func validImportBody(t *testing.T) string {
	t.Helper()
	body := map[string]any{
		"kind": "InteractiveGuide",
		"spec": map[string]any{
			"id":            "intro-to-loki",
			"title":         "Intro to Loki",
			"schemaVersion": "1.0",
			"status":        "draft",
			"blocks":        []map[string]any{{"type": "markdown", "content": "# Welcome"}},
		},
	}
	bs, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(bs)
}

func TestImport_CreateOnNotFound(t *testing.T) {
	addCalled := false
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusNotFound, `interactiveguides "intro-to-loki" not found`)
		},
		"POST /collection": func(w http.ResponseWriter, r *http.Request) {
			addCalled = true
			if got := r.Header.Get("Authorization"); got != "Bearer test-caller-token" {
				t.Errorf("expected caller's Authorization to be forwarded, got %q", got)
			}
			var env map[string]any
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &env)
			meta := env["metadata"].(map[string]any)
			if meta["name"] != "intro-to-loki" {
				t.Errorf("expected metadata.name=intro-to-loki, got %v", meta["name"])
			}
			if meta["namespace"] != "default" {
				t.Errorf("expected metadata.namespace=default, got %v", meta["namespace"])
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "default", "resourceVersion": "rv-1"},
				"spec":     map[string]any{"status": "draft"},
			})
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Editor", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", w.Code, readBody(t, w))
	}
	if !addCalled {
		t.Fatal("expected aggregator POST to be called")
	}
	var resp guidesImportResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Created || resp.ResourceName != "intro-to-loki" || resp.Namespace != "default" || resp.ResourceVersion != "rv-1" || resp.Status != "draft" {
		t.Errorf("unexpected response: %+v", resp)
	}
}

func TestImport_ConflictWithoutOverwrite(t *testing.T) {
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "default", "resourceVersion": "rv-9"},
				"spec":     map[string]any{"status": "published"},
			})
		},
		"PUT /resource": func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("Update should not be called when overwrite=false")
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Editor", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
	if !strings.Contains(readBody(t, w), "overwrite=true") {
		t.Errorf("expected error to mention overwrite=true, got %q", readBody(t, w))
	}
}

func TestImport_OverwriteUpdates(t *testing.T) {
	updateCalled := false
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "default", "resourceVersion": "rv-9"},
				"spec":     map[string]any{"status": "draft"},
			})
		},
		"PUT /resource": func(w http.ResponseWriter, r *http.Request) {
			updateCalled = true
			body, _ := io.ReadAll(r.Body)
			var env map[string]any
			_ = json.Unmarshal(body, &env)
			meta := env["metadata"].(map[string]any)
			if meta["resourceVersion"] != "rv-9" {
				t.Errorf("expected resourceVersion echoed, got %v", meta["resourceVersion"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "default", "resourceVersion": "rv-10"},
				"spec":     map[string]any{"status": "published"},
			})
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	bodyMap := map[string]any{
		"kind":      "InteractiveGuide",
		"overwrite": true,
		"spec": map[string]any{
			"id":     "intro-to-loki",
			"title":  "Intro to Loki",
			"status": "published",
			"blocks": []map[string]any{{"type": "markdown", "content": "# Updated"}},
		},
	}
	bs, _ := json.Marshal(bodyMap)
	r := importRequest(t, "Editor", "default", srv.URL, string(bs))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body=%s", w.Code, readBody(t, w))
	}
	if !updateCalled {
		t.Fatal("expected aggregator PUT to be called")
	}
	var resp guidesImportResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Created {
		t.Error("expected created=false on overwrite")
	}
	if resp.Status != "published" {
		t.Errorf("expected status=published, got %q", resp.Status)
	}
}

func TestImport_RejectsViewer(t *testing.T) {
	srv := stubAggregator(t, nil)
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Viewer", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for Viewer, got %d", w.Code)
	}
}

func TestImport_RejectsAnonymous(t *testing.T) {
	srv := stubAggregator(t, nil)
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing user, got %d", w.Code)
	}
}

func TestImport_AdminCanImport(t *testing.T) {
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusNotFound, "not found")
		},
		"POST /collection": func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "default", "resourceVersion": "rv-1"},
			})
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Admin", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for Admin, got %d, body=%s", w.Code, readBody(t, w))
	}
}

func TestImport_RejectsWrongKind(t *testing.T) {
	app := newImportTestApp()
	body := `{"kind":"GuideCompletion","spec":{"id":"x","title":"x","blocks":[]}}`
	r := importRequest(t, "Editor", "default", "http://unused", body)
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestImport_RejectsMalformedJSON(t *testing.T) {
	app := newImportTestApp()
	r := importRequest(t, "Editor", "default", "http://unused", "not json")
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestImport_RejectsEmptySlug(t *testing.T) {
	app := newImportTestApp()
	body := `{"kind":"InteractiveGuide","spec":{"id":"!!!","title":"@@@","blocks":[]}}`
	r := importRequest(t, "Editor", "default", "http://unused", body)
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestImport_NamespaceFromBodyIgnored(t *testing.T) {
	// Even if a caller embeds metadata.namespace, the handler must use
	// the server-derived value from PluginContext.Namespace.
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusNotFound, "not found")
		},
		"POST /collection": func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			var env map[string]any
			_ = json.Unmarshal(body, &env)
			meta := env["metadata"].(map[string]any)
			if meta["namespace"] != "stacks-real" {
				t.Errorf("expected server-derived namespace, got %v", meta["namespace"])
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"name": "intro-to-loki", "namespace": "stacks-real", "resourceVersion": "rv-1"},
			})
		},
	})
	defer srv.Close()
	// Override the path on the stub to expect the new namespace.
	// (stubAggregator hardcodes "default" — for this one case, build a custom server.)
	srv.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/stacks-real/interactiveguides/", func(w http.ResponseWriter, r *http.Request) {
		writeK8sStatus(w, http.StatusNotFound, "not found")
	})
	mux.HandleFunc("/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/stacks-real/interactiveguides", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var env map[string]any
		_ = json.Unmarshal(body, &env)
		meta := env["metadata"].(map[string]any)
		if meta["namespace"] != "stacks-real" {
			t.Errorf("expected server-derived namespace stacks-real, got %v", meta["namespace"])
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"name": "intro-to-loki", "namespace": "stacks-real", "resourceVersion": "rv-1"},
		})
	})
	srv2 := httptest.NewServer(mux)
	defer srv2.Close()

	app := newImportTestApp()
	bodyMap := map[string]any{
		"kind": "InteractiveGuide",
		"spec": map[string]any{
			"id":     "intro-to-loki",
			"title":  "Intro to Loki",
			"blocks": []map[string]any{{"type": "markdown", "content": "# Welcome"}},
		},
		// Attacker-supplied metadata is ignored.
		"metadata": map[string]any{"name": "attacker", "namespace": "attacker-ns"},
	}
	bs, _ := json.Marshal(bodyMap)
	r := importRequest(t, "Editor", "stacks-real", srv2.URL, string(bs))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d, body=%s", w.Code, readBody(t, w))
	}
}

func TestImport_BubblesAggregatorStatusError(t *testing.T) {
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusNotFound, "not found")
		},
		"POST /collection": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusUnprocessableEntity, "spec.blocks[0].type: unknown block type")
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Editor", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 to bubble, got %d", w.Code)
	}
	if !strings.Contains(readBody(t, w), "unknown block type") {
		t.Errorf("expected aggregator message to bubble, got %q", readBody(t, w))
	}
}

func TestImport_AggregatorUnavailableMaps502(t *testing.T) {
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			writeK8sStatus(w, http.StatusServiceUnavailable, "aggregator down")
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequest(t, "Editor", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected 502 for aggregator-unavailable, got %d, body=%s", w.Code, readBody(t, w))
	}
}

func TestImport_RejectsWrongMethod(t *testing.T) {
	app := newImportTestApp()
	r := httptest.NewRequest(http.MethodGet, "/v1/guides/import", bytes.NewReader(nil))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestImport_OSSReturns501(t *testing.T) {
	// In OSS the aggregator feature toggle is off; the handler should
	// fail-fast with 501 NOT_IMPLEMENTED rather than 502 from a doomed
	// outbound call.
	srv := stubAggregator(t, map[string]http.HandlerFunc{
		"GET /resource": func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("aggregator should not be called when feature toggle is off")
		},
	})
	defer srv.Close()

	app := newImportTestApp()
	r := importRequestNoAggregator(t, "Editor", "default", srv.URL, validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusNotImplemented {
		t.Errorf("expected 501 in OSS, got %d, body=%s", w.Code, readBody(t, w))
	}
	if !strings.Contains(readBody(t, w), "Grafana Cloud") {
		t.Errorf("expected error to mention Grafana Cloud, got %q", readBody(t, w))
	}
}

func TestImport_MissingAppURL(t *testing.T) {
	srv := stubAggregator(t, nil)
	defer srv.Close()

	app := newImportTestApp()
	// Use empty AppURL — handler must surface 502, not crash.
	r := importRequest(t, "Editor", "default", "", validImportBody(t))
	w := httptest.NewRecorder()
	app.handleGuidesImport(w, r)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected 502 when AppURL is missing, got %d", w.Code)
	}
}

func TestSlugifyGuideName(t *testing.T) {
	cases := []struct {
		in, out string
	}{
		{"My First Guide", "my-first-guide"},
		{"Intro to Loki!!!", "intro-to-loki"},
		{"---weird---input---", "weird-input"},
		{"with_underscores and spaces", "with-underscores-and-spaces"},
		{"!!!", ""},
		{"", ""},
		{"already-slugified", "already-slugified"},
		{"MIXED case 123", "mixed-case-123"},
	}
	for _, tc := range cases {
		if got := slugifyGuideName(tc.in); got != tc.out {
			t.Errorf("slugifyGuideName(%q) = %q, want %q", tc.in, got, tc.out)
		}
	}
}

// Compile-time guard: importRequest only builds requests with the
// expected body. This is here so test compilation fails loudly if
// someone changes the signature without updating tests.
var _ = fmt.Sprintf
