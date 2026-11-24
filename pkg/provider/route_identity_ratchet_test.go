package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
	"k8s.io/kube-openapi/pkg/spec3"
)

const routeRecipe = "docs/design/BACKEND_PROXY_PATTERN.md#how-to-add-or-change-a-route"

// publicRoutesWithoutCallerIdentity is the reviewed list of routes whose handler serves a caller it never verified.
// Adding a route here means serving it with no verified identity, so a change to this map needs the same
// review as a change to the unprovisioned-client exemption switch in newApp. Anything personal or tenant-scoped
// belongs in neither. See "How to add or change a route" in docs/design/BACKEND_PROXY_PATTERN.md.
var publicRoutesWithoutCallerIdentity = map[string]string{
	"/backend/package-recommendations": "anonymous public CDN recommendations feed; exempt in the unprovisioned-client switch",
	"/backend/health":                  "fixed status document that reads no data; deliberately not exempt, so an unprovisioned backend fails the browser's health probe and tenant calls never route to it",
}

// unprovisionedClientExemptions mirrors the switch in newApp that keeps a route live without a caller-exchange
// transport. Every entry must read no tenant storage; a change here needs the same review as that switch.
var unprovisionedClientExemptions = map[string]string{
	"/backend/package-recommendations":         "anonymous public CDN recommendations feed",
	"/backend/api/v1/achievements/definitions": "process-wide definitions snapshot; still verifies the caller",
}

type manifestRoute struct{ method, path string }

func (r manifestRoute) String() string { return r.method + " " + r.path }

func manifestRoutes(t *testing.T) []manifestRoute {
	t.Helper()
	var routes []manifestRoute
	for _, version := range manifestdata.LocalManifest().ManifestData.Versions {
		if version.Name != "v1alpha1" {
			continue
		}
		//nolint:staticcheck // the generated manifest still declares custom routes in the deprecated Routes field
		for path, props := range version.Routes.Namespaced {
			for method, operation := range map[string]*spec3.Operation{http.MethodGet: props.Get, http.MethodPost: props.Post, http.MethodPut: props.Put, http.MethodDelete: props.Delete, http.MethodPatch: props.Patch} {
				if operation != nil {
					routes = append(routes, manifestRoute{method, path})
				}
			}
		}
	}
	sort.Slice(routes, func(i, j int) bool { return routes[i].String() < routes[j].String() })
	if len(routes) == 0 {
		t.Fatal("manifestdata.LocalManifest() declares no v1alpha1 namespaced routes; update this ratchet if the manifest moved")
	}
	return routes
}

type routeRequest struct{ query, body string }

const (
	ratchetGuide    = `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"InteractiveGuide","metadata":{"name":"sample"%s},"spec":{"id":"sample","title":"Sample","status":"draft","schemaVersion":"1.0","blocks":[]}}`
	ratchetSettings = `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"PathfinderSettings","metadata":{"name":"default"%s},"spec":{}}`
	resourceVersion = `,"resourceVersion":"1"`
)

// routeRequests holds a request per route that a verified caller gets past input validation with, so a refusal
// of the same request from an unverified caller can only come from the identity check.
func routeRequests() map[string]routeRequest {
	completion, _ := json.Marshal(sdkCompletionBody())
	event := fmt.Sprintf(`{"schemaVersion":1,"eventId":"ratchet","entity":"guides","action":"completed","occurredAt":%q,"context":{"guideSource":"bundled","guideId":"first-dashboard","guideCategory":"interactive"}}`, time.Now().UTC().Format(time.RFC3339))
	return map[string]routeRequest{
		"GET /backend/custom-guide":                {query: "name=sample"},
		"POST /backend/custom-guide":               {query: "name=sample", body: fmt.Sprintf(ratchetGuide, "")},
		"PUT /backend/custom-guide":                {query: "name=sample", body: fmt.Sprintf(ratchetGuide, resourceVersion)},
		"DELETE /backend/custom-guide":             {query: "name=sample"},
		"POST /backend/pathfinder-settings":        {body: fmt.Sprintf(ratchetSettings, "")},
		"PUT /backend/pathfinder-settings":         {body: fmt.Sprintf(ratchetSettings, resourceVersion)},
		"POST /backend/completion-records":         {body: string(completion)},
		"POST /backend/api/v1/achievements/events": {body: event},
	}
}

type routeCaller struct{ adminIdentity }

func (routeCaller) GetUsername() string { return "login" }
func (routeCaller) GetName() string     { return "Display" }

func callerIn(namespace string) context.Context {
	claims := fmt.Sprintf(`{"sub":"user:1","namespace":%q,"role":"Admin"}`, namespace)
	identity := routeCaller{adminIdentity{completionIdentity: completionIdentity{testIdentity{namespace: namespace}, "user:1"}, idToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".signature"}}
	return authlib.WithAuthInfo(context.Background(), identity)
}

func callRoute(application app.App, ctx context.Context, namespace string, route manifestRoute) (*httptest.ResponseRecorder, error) {
	request := routeRequests()[route.String()]
	recorder := httptest.NewRecorder()
	err := application.CallCustomRoute(ctx, recorder, &app.CustomRouteRequest{
		Method: route.method, Path: strings.TrimPrefix(route.path, "/"), URL: &url.URL{RawQuery: request.query}, Headers: http.Header{},
		Body:               io.NopCloser(strings.NewReader(request.body)),
		ResourceIdentifier: resource.FullIdentifier{Group: "pathfinderbackend.ext.grafana.app", Version: "v1alpha1", Namespace: namespace},
	})
	return recorder, err
}

func recordingUpstream(t *testing.T) (rest.Config, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"List","items":[],"metadata":{}}`))
	}))
	t.Cleanup(upstream.Close)
	return rest.Config{Host: upstream.URL, APIPath: "/apis", WrapTransport: func(rt http.RoundTripper) http.RoundTripper { return rt }}, &requests
}

// routesServingAnUnverifiedCaller calls every route twice, with no identity and with an identity bound to another
// namespace, and reports each call that reached upstream storage or answered as if the caller were accepted.
func routesServingAnUnverifiedCaller(application app.App, routes []manifestRoute, upstreamRequests *atomic.Int32) []string {
	unverified := map[string]context.Context{
		"no identity":       context.Background(),
		"another namespace": callerIn("stacks-2"),
	}
	var violations []string
	for _, route := range routes {
		for _, label := range []string{"no identity", "another namespace"} {
			before := upstreamRequests.Load()
			recorder, err := callRoute(application, unverified[label], "stacks-1", route)
			switch {
			case errors.Is(err, app.ErrCustomRouteNotFound):
				violations = append(violations, fmt.Sprintf("%s is in the manifest but the provider does not dispatch it", route))
			case upstreamRequests.Load() != before:
				violations = append(violations, fmt.Sprintf("%s with %s reached upstream storage", route, label))
			case err == nil && recorder.Code < 300 && !strings.Contains(recorder.Body.String(), "identity-unavailable"):
				violations = append(violations, fmt.Sprintf("%s with %s answered %d without refusing the caller", route, label, recorder.Code))
			}
		}
	}
	return violations
}

func TestProviderRegistersExactlyTheManifestRoutes(t *testing.T) {
	config, err := appConfig(app.Config{}, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	registered := map[string]bool{}
	for route := range config.VersionedCustomRoutes["v1alpha1"] {
		if !route.Namespaced {
			t.Errorf("%s %s is registered cluster-scoped; tenant routes are namespaced", route.Method, route.Path)
		}
		registered[manifestRoute{string(route.Method), route.Path}.String()] = true
	}
	var problems []string
	for _, route := range manifestRoutes(t) {
		if !registered[route.String()] {
			problems = append(problems, fmt.Sprintf("%s is declared in kinds/manifest.cue but not registered in VersionedCustomRoutes in pkg/provider/provider.go", route))
		}
		delete(registered, route.String())
	}
	for route := range registered {
		problems = append(problems, fmt.Sprintf("%s is registered in VersionedCustomRoutes in pkg/provider/provider.go but not declared in kinds/manifest.cue", route))
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		t.Fatalf("Backend route registrations are out of step:\n  %s\nDeclare the route in kinds/manifest.cue (then run `npm run generate:kinds`) and register it in pkg/provider/provider.go. Procedure: %s", strings.Join(problems, "\n  "), routeRecipe)
	}
}

func ratchetApp(t *testing.T) (app.App, *atomic.Int32) {
	t.Helper()
	cfg, upstreamRequests := recordingUpstream(t)
	noGuides := services.PathGuideSource(func(context.Context, string, string, string) ([]services.AssignmentGuideIdentity, bool, error) {
		return nil, false, nil
	})
	application, err := newApp(app.Config{KubeConfig: cfg}, noGuides, func() services.PathGuideSource { return noGuides }, nil, achievementDefinitionsForTest(t))
	if err != nil {
		t.Fatal(err)
	}
	return application, upstreamRequests
}

func TestEveryTenantRouteRefusesAnUnverifiedCaller(t *testing.T) {
	var tenantRoutes []manifestRoute
	for _, route := range manifestRoutes(t) {
		if _, public := publicRoutesWithoutCallerIdentity[route.path]; !public {
			tenantRoutes = append(tenantRoutes, route)
		}
	}
	application, upstreamRequests := ratchetApp(t)
	if violations := routesServingAnUnverifiedCaller(application, tenantRoutes, upstreamRequests); len(violations) > 0 {
		t.Fatalf("Every tenant route must derive its caller with callerNamespace or completionCaller before touching storage.\n  %s\nFix the handler. Only a genuinely public route may be added to publicRoutesWithoutCallerIdentity, and that change needs review. See %s.", strings.Join(violations, "\n  "), routeRecipe)
	}

	for index, route := range tenantRoutes {
		application, upstreamRequests := ratchetApp(t)
		namespace := fmt.Sprintf("stacks-%d", 1000+index)
		recorder, err := callRoute(application, callerIn(namespace), namespace, route)
		_, readsNoStorage := unprovisionedClientExemptions[route.path]
		switch {
		case err != nil:
			t.Errorf("%s from a verified caller failed: %v", route, err)
		case readsNoStorage && recorder.Code >= 300:
			t.Errorf("%s from a verified caller answered %d %s, so its refusal of an unverified caller proves nothing", route, recorder.Code, recorder.Body.String())
		case !readsNoStorage && upstreamRequests.Load() == 0:
			t.Errorf("%s from a verified caller never reached upstream (%d %s); give it a request in routeRequests that passes validation, or its refusal of an unverified caller proves nothing", route, recorder.Code, recorder.Body.String())
		}
	}
}

func TestPublicRouteAllowlistsMatchTheUnprovisionedExemption(t *testing.T) {
	routes := manifestRoutes(t)
	declared := map[string]bool{}
	for _, route := range routes {
		declared[route.path] = true
	}
	for _, allowlist := range []map[string]string{publicRoutesWithoutCallerIdentity, unprovisionedClientExemptions} {
		for path := range allowlist {
			if !declared[path] {
				t.Errorf("%s is allowlisted but is not a manifest route; remove the stale entry", path)
			}
		}
	}

	recommendations := func(context.Context) (json.RawMessage, bool, error) { return json.RawMessage(`{}`), true, nil }
	application, err := newApp(app.Config{}, nil, nil, recommendations)
	if err != nil {
		t.Fatal(err)
	}
	ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity{namespace: "stacks-1"}, "user:1"})
	for _, route := range routes {
		recorder, err := callRoute(application, ctx, "stacks-1", route)
		if err != nil {
			t.Fatalf("%s: %v", route, err)
		}
		_, exempt := unprovisionedClientExemptions[route.path]
		if served := !strings.Contains(recorder.Body.String(), "obo-unavailable"); served != exempt {
			t.Errorf("%s served=%t without a caller-exchange transport, but unprovisionedClientExemptions says %t; the switch in newApp and this reviewed list must agree, and a personal or tenant route belongs in neither. See %s.", route, served, exempt, routeRecipe)
		}
	}
}

func TestUnverifiedCallerRatchetRejectsALeakyHandler(t *testing.T) {
	cfg, upstreamRequests := recordingUpstream(t)
	leaky := func(ctx context.Context, w app.CustomRouteResponseWriter, _ *app.CustomRouteRequest) error {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, cfg.Host, nil)
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			_ = response.Body.Close()
		}
		return nil
	}
	guarded := func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		if _, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace); err != nil {
			w.WriteHeader(http.StatusForbidden)
			return nil
		}
		return leaky(ctx, w, req)
	}
	application, err := simple.NewApp(simple.AppConfig{Name: "ratchet", VersionedCustomRoutes: map[string]simple.AppVersionRouteHandlers{"v1alpha1": {
		simple.AppVersionRoute{Namespaced: true, Path: "/backend/guarded", Method: simple.AppCustomRouteMethodGet}: guarded,
		simple.AppVersionRoute{Namespaced: true, Path: "/backend/leaky", Method: simple.AppCustomRouteMethodPost}:  leaky,
	}}})
	if err != nil {
		t.Fatal(err)
	}
	violations := routesServingAnUnverifiedCaller(application, []manifestRoute{{http.MethodGet, "/backend/guarded"}, {http.MethodPost, "/backend/leaky"}, {http.MethodGet, "/backend/missing"}}, upstreamRequests)
	want := []string{
		"POST /backend/leaky with no identity reached upstream storage",
		"POST /backend/leaky with another namespace reached upstream storage",
		"GET /backend/missing is in the manifest but the provider does not dispatch it",
		"GET /backend/missing is in the manifest but the provider does not dispatch it",
	}
	if strings.Join(violations, "\n") != strings.Join(want, "\n") {
		t.Fatalf("violations=%q", violations)
	}
}
