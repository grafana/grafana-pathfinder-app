package provider

import (
	"context"
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

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
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

func callRoute(application app.App, ctx context.Context, route manifestRoute) (*httptest.ResponseRecorder, error) {
	recorder := httptest.NewRecorder()
	err := application.CallCustomRoute(ctx, recorder, &app.CustomRouteRequest{
		Method: route.method, Path: strings.TrimPrefix(route.path, "/"), URL: &url.URL{}, Headers: http.Header{},
		Body:               io.NopCloser(strings.NewReader("{}")),
		ResourceIdentifier: resource.FullIdentifier{Group: "pathfinderbackend.ext.grafana.app", Version: "v1alpha1", Namespace: "stacks-1"},
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
		"another namespace": authlib.WithAuthInfo(context.Background(), adminIdentity{completionIdentity: completionIdentity{testIdentity{namespace: "stacks-2"}, "user:1"}, accessToken: "token"}),
	}
	var violations []string
	for _, route := range routes {
		for _, label := range []string{"no identity", "another namespace"} {
			before := upstreamRequests.Load()
			recorder, err := callRoute(application, unverified[label], route)
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

func TestEveryTenantRouteRefusesAnUnverifiedCaller(t *testing.T) {
	cfg, upstreamRequests := recordingUpstream(t)
	application, err := newApp(app.Config{KubeConfig: cfg}, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	var tenantRoutes []manifestRoute
	for _, route := range manifestRoutes(t) {
		if _, public := publicRoutesWithoutCallerIdentity[route.path]; !public {
			tenantRoutes = append(tenantRoutes, route)
		}
	}
	if violations := routesServingAnUnverifiedCaller(application, tenantRoutes, upstreamRequests); len(violations) > 0 {
		t.Fatalf("Every tenant route must derive its caller with callerNamespace or completionCaller before touching storage.\n  %s\nFix the handler. Only a genuinely public route may be added to publicRoutesWithoutCallerIdentity, and that change needs review. See %s.", strings.Join(violations, "\n  "), routeRecipe)
	}

	verified := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "stacks-1"})
	if _, err := callRoute(application, verified, manifestRoute{http.MethodGet, "/backend/pathfinder-settings"}); err != nil || upstreamRequests.Load() == 0 {
		t.Fatalf("a verified caller never reached the recording upstream (error=%v), so the refusals above prove nothing", err)
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
		recorder, err := callRoute(application, ctx, route)
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
