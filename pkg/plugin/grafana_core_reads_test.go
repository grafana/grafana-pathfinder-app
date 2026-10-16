package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

const (
	coreReadCapToken    = "test-cap-token"
	coreReadMintedToken = "minted-obo-token"
	coreReadExchange    = "/v1/sign-access-token"
)

type coreReadRoute struct {
	name     string
	target   string
	handler  func(*App) http.HandlerFunc
	upstream string
	maxBytes int
}

var coreReadRoutes = []coreReadRoute{
	{"user", "/grafana/user", func(a *App) http.HandlerFunc { return a.handleGrafanaUser }, "/apis/iam.grafana.app/v0alpha1/namespaces/stacks-1/users/~", grafanaUserMaxBytes},
	{"dashboard", "/grafana/dashboard?uid=abc", func(a *App) http.HandlerFunc { return a.handleGrafanaDashboard }, "/apis/dashboard.grafana.app/v1beta1/namespaces/stacks-1/dashboards/abc", grafanaDashboardMaxBytes},
	{"search", "/grafana/dashboard-search?query=cpu", func(a *App) http.HandlerFunc { return a.handleGrafanaDashboardSearch }, "/apis/dashboard.grafana.app/v0alpha1/namespaces/stacks-1/search", grafanaDashboardSearchMaxBytes},
}

// newCoreReadStack serves one origin as the whole stack: the JWKS the identity
// gate verifies against, auth-api's token exchange, and the /apis upstream.
// The App carries a real auth.Exchanger pointed at it, so the handler runs
// unmodified from inbound ID token to outbound X-Access-Token.
func newCoreReadStack(t *testing.T, apis http.HandlerFunc) (*App, map[string]string) {
	t.Helper()
	jwks := jwksBody(testSigningKeyID, testSigningKey())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case auth.SigningKeysPath:
			_, _ = w.Write(jwks)
		case coreReadExchange:
			if r.Header.Get("Authorization") != "Bearer "+coreReadCapToken {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"bad cap token"}`))
				return
			}
			_, _ = w.Write([]byte(`{"data":{"token":"` + coreReadMintedToken + `"}}`))
		default:
			if !strings.HasPrefix(r.URL.Path, "/apis/") {
				t.Errorf("unexpected upstream path %s", r.URL.Path)
			}
			if r.Header.Get(auth.AccessTokenHeader) != coreReadMintedToken {
				t.Errorf("%s: %s = %q, want the minted token", r.URL.Path, auth.AccessTokenHeader, r.Header.Get(auth.AccessTokenHeader))
			}
			for _, h := range []string{"Cookie", "Authorization", backend.GrafanaUserSignInTokenHeaderName} {
				if r.Header.Get(h) != "" {
					t.Errorf("%s: forwarded %s", r.URL.Path, h)
				}
			}
			apis(w, r)
		}
	}))
	t.Cleanup(server.Close)
	app := newTestApp(t)
	ex, err := auth.New(coreReadCapToken, server.URL+coreReadExchange)
	if err != nil {
		t.Fatalf("building exchanger: %v", err)
	}
	app.oboExchanger = ex
	return app, map[string]string{sdkconfig.AppURL: server.URL}
}

func serveCoreRead(t *testing.T, app *App, route coreReadRoute, target string, cfg map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	route.handler(app)(rec, customGuideRequestWithConfig(t, target, "user:1", cfg))
	return rec
}

type coreReadErrorEnvelope struct {
	Error       string                `json:"error"`
	Diagnostics *guideProxyDiagnostic `json:"diagnostics"`
}

func decodeCoreReadError(t *testing.T, rec *httptest.ResponseRecorder) coreReadErrorEnvelope {
	t.Helper()
	var env coreReadErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v (raw %s)", err, rec.Body.String())
	}
	return env
}

func TestGrafanaCoreReads_MethodNotAllowed(t *testing.T) {
	for _, route := range coreReadRoutes {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
			rec := httptest.NewRecorder()
			route.handler(newTestApp(t))(rec, httptest.NewRequest(method, route.target, nil))
			if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != http.MethodGet {
				t.Errorf("%s %s: status %d allow %q", route.name, method, rec.Code, rec.Header().Get("Allow"))
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("%s %s: missing no-store", route.name, method)
			}
		}
	}
}

func TestGrafanaCoreReads_UnverifiedCallerIsForbidden(t *testing.T) {
	for _, route := range coreReadRoutes {
		var hits atomic.Int32
		app, cfg := newCoreReadStack(t, func(http.ResponseWriter, *http.Request) { hits.Add(1) })
		for name, token := range map[string]string{"absent": "", "forged": "a.b.c"} {
			r := customGuideRequestWithConfig(t, route.target, "user:1", cfg)
			r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
			rec := httptest.NewRecorder()
			route.handler(app)(rec, r)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s/%s: status %d", route.name, name, rec.Code)
			}
			env := decodeCoreReadError(t, rec)
			if env.Error != reasonIdentityUnavailable || env.Diagnostics == nil || env.Diagnostics.Stage != "identity" || env.Diagnostics.Reason != "identity-unavailable" {
				t.Errorf("%s/%s: envelope %s", route.name, name, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("%s/%s: missing no-store", route.name, name)
			}
		}
		if hits.Load() != 0 {
			t.Errorf("%s: unverified caller reached the upstream", route.name)
		}
	}
}

func TestGrafanaCoreReads_MissingExchangerIsProxyUnavailable(t *testing.T) {
	for _, route := range coreReadRoutes {
		rec := httptest.NewRecorder()
		route.handler(newTestApp(t))(rec, customGuideRequestWithConfig(t, route.target, "user:1", testGrafanaConfig()))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s: status %d %s", route.name, rec.Code, rec.Body.String())
		}
		env := decodeCoreReadError(t, rec)
		if env.Error != "app platform proxy unavailable" || env.Diagnostics == nil || env.Diagnostics.Reason != "proxy-unavailable" || env.Diagnostics.Stage != "configuration" {
			t.Errorf("%s: envelope %s", route.name, rec.Body.String())
		}
	}
}

func TestGrafanaCoreReads_UpstreamStatusMapping(t *testing.T) {
	for _, route := range coreReadRoutes {
		for upstream, want := range map[int]int{404: 404, 500: 500, 403: 403, 401: http.StatusBadGateway, 302: http.StatusBadGateway} {
			app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Location", "/elsewhere")
				w.WriteHeader(upstream)
			})
			rec := serveCoreRead(t, app, route, route.target, cfg)
			if rec.Code != want {
				t.Errorf("%s upstream %d: status %d, want %d", route.name, upstream, rec.Code, want)
				continue
			}
			env := decodeCoreReadError(t, rec)
			if env.Error != "app platform read failed" || env.Diagnostics == nil || env.Diagnostics.UpstreamStatus != upstream || env.Diagnostics.Stage != "app-platform" {
				t.Errorf("%s upstream %d: envelope %s", route.name, upstream, rec.Body.String())
			}
		}
	}
}

func TestGrafanaCoreReads_OversizeAndInvalidBodies(t *testing.T) {
	for _, route := range coreReadRoutes {
		for reason, body := range map[string]string{
			"response-too-large": `"` + strings.Repeat("x", route.maxBytes) + `"`,
			"invalid-json":       "{not json",
		} {
			app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) })
			rec := serveCoreRead(t, app, route, route.target, cfg)
			if rec.Code != http.StatusBadGateway {
				t.Errorf("%s %s: status %d", route.name, reason, rec.Code)
				continue
			}
			if env := decodeCoreReadError(t, rec); env.Diagnostics == nil || env.Diagnostics.Reason != reason {
				t.Errorf("%s %s: envelope %s", route.name, reason, rec.Body.String())
			}
		}
	}
}

func TestGrafanaCoreReads_MintFailureIsBadGateway(t *testing.T) {
	route := coreReadRoutes[0]
	app, cfg := newCoreReadStack(t, func(http.ResponseWriter, *http.Request) { t.Error("upstream reached without a minted token") })
	ex, err := auth.New("wrong-cap-token", cfg[sdkconfig.AppURL]+coreReadExchange)
	if err != nil {
		t.Fatal(err)
	}
	app.oboExchanger = ex
	rec := serveCoreRead(t, app, route, route.target, cfg)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d", rec.Code)
	}
	if env := decodeCoreReadError(t, rec); env.Diagnostics == nil || env.Diagnostics.Stage != "token-exchange" {
		t.Errorf("envelope %s", rec.Body.String())
	}
}

func TestGrafanaUser_PassesCallerObjectThrough(t *testing.T) {
	const body = `{"kind":"User","metadata":{"name":"u-1"},"spec":{"login":"alice","role":"Editor"}}`
	route := coreReadRoutes[0]
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != route.upstream || r.URL.RawQuery != "" {
			t.Errorf("upstream %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(body))
	})
	rec := serveCoreRead(t, app, route, route.target, cfg)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != body {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("caller's user object must not be cached")
	}
}

func TestGrafanaDashboard_ShapesDashboardAndFolder(t *testing.T) {
	route := coreReadRoutes[1]
	var paths []string
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case route.upstream:
			_, _ = w.Write([]byte(`{"metadata":{"name":"abc","annotations":{"grafana.app/folder":"f-1"}},"spec":{"title":"CPU","tags":["infra","linux"],"panels":[{"id":1}]}}`))
		case "/apis/folder.grafana.app/v1beta1/namespaces/stacks-1/folders/f-1":
			_, _ = w.Write([]byte(`{"metadata":{"name":"f-1"},"spec":{"title":"Infrastructure"}}`))
		default:
			t.Errorf("unexpected upstream %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	rec := serveCoreRead(t, app, route, route.target, cfg)
	const want = `{"uid":"abc","title":"CPU","tags":["infra","linux"],"folderUid":"f-1","folderTitle":"Infrastructure"}`
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if len(paths) != 2 {
		t.Errorf("upstream calls %v", paths)
	}
}

func TestGrafanaDashboard_FolderTitleIsBestEffort(t *testing.T) {
	route := coreReadRoutes[1]
	for name, folder := range map[string]http.HandlerFunc{
		"forbidden": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) },
		"error":     func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
		"invalid":   func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"spec":`)) },
	} {
		app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == route.upstream {
				_, _ = w.Write([]byte(`{"metadata":{"name":"abc","annotations":{"grafana.app/folder":"f-1"}},"spec":{"title":"CPU"}}`))
				return
			}
			folder(w, r)
		})
		rec := serveCoreRead(t, app, route, route.target, cfg)
		const want = `{"uid":"abc","title":"CPU","tags":[],"folderUid":"f-1","folderTitle":""}`
		if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != want {
			t.Errorf("%s: status %d body %s", name, rec.Code, rec.Body.String())
		}
	}
}

func TestGrafanaDashboard_NoFolderSkipsFolderRead(t *testing.T) {
	route := coreReadRoutes[1]
	var calls atomic.Int32
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"metadata":{"name":"abc"},"spec":{"title":"CPU","tags":null}}`))
	})
	rec := serveCoreRead(t, app, route, route.target, cfg)
	const want = `{"uid":"abc","title":"CPU","tags":[],"folderUid":"","folderTitle":""}`
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != want || calls.Load() != 1 {
		t.Fatalf("status %d calls %d body %s", rec.Code, calls.Load(), rec.Body.String())
	}
}

func TestGrafanaDashboard_RejectsInvalidUID(t *testing.T) {
	route := coreReadRoutes[1]
	app, cfg := newCoreReadStack(t, func(http.ResponseWriter, *http.Request) { t.Error("invalid uid reached the upstream") })
	for _, query := range []string{"", "uid=", "uid=.", "uid=..", "uid=a%2Fb", "uid=a+b", "uid=a%00", "uid=%C3%A9", "uid=" + strings.Repeat("a", grafanaDashboardUIDMaxLen+1)} {
		rec := serveCoreRead(t, app, route, "/grafana/dashboard?"+query, cfg)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status %d", query, rec.Code)
		}
	}
}

func TestGrafanaDashboard_AcceptsMaxLengthUID(t *testing.T) {
	route := coreReadRoutes[1]
	uid := "A._-" + strings.Repeat("z", grafanaDashboardUIDMaxLen-4)
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/dashboard.grafana.app/v1beta1/namespaces/stacks-1/dashboards/"+uid {
			t.Errorf("upstream %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"metadata":{"name":"` + uid + `"},"spec":{}}`))
	})
	if rec := serveCoreRead(t, app, route, "/grafana/dashboard?uid="+uid, cfg); rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
}

func TestGrafanaDashboardSearch_ShapesHits(t *testing.T) {
	route := coreReadRoutes[2]
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != route.upstream || r.URL.RawQuery != "limit=100&query=cpu&type=dashboard" {
			t.Errorf("upstream %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"totalHits":2,"hits":[{"resource":"dashboards","name":"abc","title":"CPU","folder":"f-1","tags":["infra"]},{"resource":"dashboards","name":"def","title":"Memory"}]}`))
	})
	rec := serveCoreRead(t, app, route, route.target, cfg)
	const want = `{"hits":[{"uid":"abc","title":"CPU","folderUid":"f-1","tags":["infra"]},{"uid":"def","title":"Memory","folderUid":"","tags":[]}]}`
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestGrafanaDashboardSearch_ZeroHitsIsEmptyArray(t *testing.T) {
	route := coreReadRoutes[2]
	for _, body := range []string{`{"totalHits":0,"hits":[]}`, `{"totalHits":0,"hits":null}`, `{"totalHits":0}`} {
		app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) })
		rec := serveCoreRead(t, app, route, route.target, cfg)
		if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"hits":[]}` {
			t.Errorf("%s: status %d body %s", body, rec.Code, rec.Body.String())
		}
	}
}

func TestGrafanaDashboardSearch_QueryBounds(t *testing.T) {
	route := coreReadRoutes[2]
	var gotQuery atomic.Value
	app, cfg := newCoreReadStack(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery.Store(r.URL.RawQuery)
		_, _ = w.Write([]byte(`{"hits":[]}`))
	})
	if rec := serveCoreRead(t, app, route, "/grafana/dashboard-search", cfg); rec.Code != http.StatusOK || gotQuery.Load() != "limit=100&type=dashboard" {
		t.Errorf("no query: status %d upstream query %v", rec.Code, gotQuery.Load())
	}
	atMax := strings.Repeat("é", grafanaDashboardSearchQueryMax)
	if rec := serveCoreRead(t, app, route, "/grafana/dashboard-search?query="+url.QueryEscape(atMax), cfg); rec.Code != http.StatusOK {
		t.Errorf("256-char query: status %d", rec.Code)
	}
	tooLong := strings.Repeat("a", grafanaDashboardSearchQueryMax+1)
	if rec := serveCoreRead(t, app, route, "/grafana/dashboard-search?query="+tooLong, cfg); rec.Code != http.StatusBadRequest {
		t.Errorf("257-char query: status %d", rec.Code)
	}
}
