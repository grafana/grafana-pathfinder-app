package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGuideProxyDiagnosticReasons(t *testing.T) {
	for _, status := range []int{401, 403, 404, 429, 500, 503} {
		diagnostic := classifyGuideProxyError(&appPlatformUpstreamError{status: status, msg: "private upstream body"})
		if diagnostic.Reason != "http-error" || diagnostic.UpstreamStatus != status {
			t.Fatalf("status %d: %+v", status, diagnostic)
		}
		body, err := json.Marshal(diagnostic)
		if err != nil || strings.Contains(string(body), "private") {
			t.Fatalf("unsafe diagnostic: %s (%v)", body, err)
		}
	}
	if classifyGuideProxyError(context.DeadlineExceeded).Reason != "timeout" {
		t.Fatal("deadline not classified")
	}
	if classifyGuideProxyError(&tokenExchangeError{err: errors.New("private token")}).Reason != "token-exchange-failed" {
		t.Fatal("token exchange not classified")
	}
}

func TestGuideProxyDiagnosticCacheCopies(t *testing.T) {
	original := &PackageRecommendationsResponse{Diagnostics: &guideProxyDiagnostic{Outcome: "degraded", ManifestFailures: map[string]int{"timeout": 1}}}
	first, err := packageResponseDiagnostics(original, nil, "refresh", 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := packageResponseDiagnostics(original, nil, "hit", 500)
	if err != nil {
		t.Fatal(err)
	}
	if first.Diagnostics.Cache != "refresh" || second.Diagnostics.Cache != "hit" || second.Diagnostics.CacheAgeMS != 500 || original.Diagnostics.Cache != "" {
		t.Fatal("cache diagnostics mutated shared response")
	}
	_, cachedErr := packageResponseDiagnostics(nil, context.DeadlineExceeded, "hit", 500)
	diagnostic := classifyGuideProxyError(cachedErr)
	if diagnostic.Cache != "hit" || diagnostic.Reason != "timeout" || diagnostic.CacheAgeMS != 500 {
		t.Fatalf("lost cached failure: %+v", diagnostic)
	}
}

func TestGuideProxyManifestFailures(t *testing.T) {
	diagnostics := &guideProxyDiagnostic{Outcome: "ok", ManifestFailures: make(map[string]int)}
	packages := []PackageEntry{{Path: "a", Targeting: &PackageTargeting{}}, {Path: "b", Targeting: &PackageTargeting{}}}
	partial := enrichPackagesWithManifests(context.Background(), "https://interactive-learning.grafana.net/", packages,
		func(_ context.Context, url string, _ int64) ([]byte, error) {
			if strings.Contains(url, "/a/") {
				return nil, &guideProxyError{diagnostic: guideProxyDiagnostic{Outcome: "error", Reason: "http-error", UpstreamStatus: 404}, err: errors.New("private body")}
			}
			return []byte("malformed private manifest"), nil
		}, diagnostics)
	if partial || diagnostics.ManifestFailures["http-error"] != 1 || diagnostics.ManifestFailures["invalid-json"] != 1 {
		t.Fatalf("missing enrichment diagnostics: %+v", diagnostics)
	}
}

func TestCustomCatalogueTransientDiagnostic(t *testing.T) {
	app := &App{}
	response := httptest.NewRecorder()
	app.writeCustomGuideUnavailable(response, &appPlatformUpstreamError{status: 503, msg: "private upstream body"})
	if response.Code != 503 || response.Header().Get("Retry-After") == "" {
		t.Fatal("transient response contract changed")
	}
	if strings.Contains(response.Body.String(), "private") || !strings.Contains(response.Body.String(), `"upstreamStatus":503`) {
		t.Fatalf("unsafe or missing diagnostics: %s", response.Body.String())
	}
}
