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

func TestAppPlatformDiagnosticPreservesFailureStage(t *testing.T) {
	cases := []struct {
		err           error
		stage, reason string
		status        int
	}{
		{&tokenExchangeError{err: errors.New("secret-token")}, "token-exchange", "token-exchange-failed", 0},
		{&tokenExchangeError{err: context.DeadlineExceeded}, "token-exchange", "token-exchange-failed", 0},
		{context.DeadlineExceeded, "app-platform", "timeout", 0},
		{context.Canceled, "app-platform", "cancelled", 0},
		{&appPlatformUpstreamError{status: 403, msg: "private body"}, "app-platform", "authorization-denied", 403},
		{&appPlatformUpstreamError{status: 429}, "app-platform", "http-error", 429},
		{&appPlatformUpstreamError{status: 503}, "app-platform", "http-error", 503},
	}
	for _, tc := range cases {
		d := appPlatformDiagnostic(tc.err, "completionrecords", "create")
		if d.Stage != tc.stage || d.Reason != tc.reason || d.UpstreamStatus != tc.status {
			t.Fatalf("unexpected classification: %+v", d)
		}
		w := httptest.NewRecorder()
		(&App{}).writeProxyError(w, "completion-write-unavailable", 503, d)
		if w.Code != 503 || strings.Contains(w.Body.String(), "secret-token") || strings.Contains(w.Body.String(), "private body") {
			t.Fatalf("unsafe response: %s", w.Body.String())
		}
	}
	if appPlatformDiagnostic(nil, "interactiveguides", "list") != nil {
		t.Fatal("successful empty list must not imply denial")
	}
}

func TestProxyFailureLogsExcludeExpectedOutcomes(t *testing.T) {
	for _, tc := range []struct {
		name, resource, operation string
		err                       error
		want                      bool
	}{
		{"success", "interactiveguides", "list", nil, false},
		{"cancel", "completionrecords", "list", context.Canceled, false},
		{"exchange cancel", "completionrecords", "list", &tokenExchangeError{err: context.Canceled}, false},
		{"settings absent", "pathfindersettings", "get", &appPlatformUpstreamError{status: 404}, false},
		{"collection unsupported", "completionrecords", "list", &appPlatformUpstreamError{status: 404}, false},
		{"unsupported", "interactiveguides", "list", &appPlatformUpstreamError{status: 501}, false},
		{"idempotent write", "completionrecords", "create", &appPlatformUpstreamError{status: 409}, false},
		{"missing guide", "interactiveguides", "get", &appPlatformUpstreamError{status: 404}, true},
		{"denied", "pathfindersettings", "get", &appPlatformUpstreamError{status: 403}, true},
		{"exchange", "completionrecords", "create", &tokenExchangeError{err: errors.New("secret")}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := newCapturingLogger()
			logAppPlatformResult(logger, "stacks-1", tc.resource, tc.operation, tc.err)
			if logger.warnedWith("Pathfinder proxy operation failed") != tc.want {
				t.Fatal("unexpected failure log")
			}
		})
	}
}

type diagnosticLogger struct {
	capturingLogger
	fields []interface{}
}

func (l *diagnosticLogger) Warn(msg string, fields ...interface{}) {
	l.capturingLogger.Warn(msg, fields...)
	l.fields = fields
}

func TestProxyFailureLogDoesNotExposeUpstreamError(t *testing.T) {
	logger := &diagnosticLogger{capturingLogger: newCapturingLogger()}
	logAppPlatformResult(logger, "stacks-1", "completionrecords", "create", &tokenExchangeError{err: errors.New("private-token-and-body")})
	body, err := json.Marshal(logger.fields)
	if err != nil || strings.Contains(string(body), "private-token") || !strings.Contains(string(body), "token-exchange-failed") || !strings.Contains(string(body), "pathfinder_proxy_failure") {
		t.Fatalf("unexpected structured log: %s", body)
	}
}
