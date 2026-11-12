package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type cohortTransport func(*http.Request) (*http.Response, error)

func (f cohortTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMyCohorts(t *testing.T) {
	server, _ := startJWKSServer(t)
	old := signingKeysURL
	signingKeysURL = server.URL + "/api/signing-keys/keys"
	t.Cleanup(func() { signingKeysURL = old })
	for _, tc := range []struct {
		name, subject, email, namespace, query, upstream string
		verified                                         bool
		status                                           int
	}{
		{"member", "user:one", "Person@example.com", testNamespace, "", `{"cohorts":["A"],"email_hash":"must-not-escape"}`, true, 200},
		{"unknown", "user:two", "other@example.com", testNamespace, "", `{"cohorts":[]}`, true, 200},
		{"unverified email", "user:one", "Person@example.com", testNamespace, "", "", false, 401},
		{"missing email", "user:one", "", testNamespace, "", "", true, 401},
		{"service account", "service-account:one", "a@example.com", testNamespace, "", "", true, 401},
		{"other stack", "user:one", "a@example.com", "stacks-other", "", "", true, 401},
		{"arbitrary identity", "user:one", "a@example.com", testNamespace, "?email_hash=other", "", true, 400},
		{"invalid response", "user:one", "a@example.com", testNamespace, "", `{"cohorts":null}`, true, 502},
		{"oversized response", "user:one", "a@example.com", testNamespace, "", strings.Repeat(" ", cohortResponseMaxBytes+1), true, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestApp(t)
			app.cohortLookupToken = "server-secret"
			calls := 0
			app.cohortClient = &http.Client{Transport: cohortTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.String() != cohortLookupURL || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer server-secret" {
					t.Fatal("incorrect upstream request")
				}
				body, _ := io.ReadAll(r.Body)
				hash := sha256.Sum256([]byte(tc.email))
				if string(body) != `{"email_hash":"`+hex.EncodeToString(hash[:])+`"}` {
					t.Fatalf("unexpected hash payload")
				}
				if r.Header.Get("Cookie") != "" || r.Header.Get(backend.GrafanaUserSignInTokenHeaderName) != "" {
					t.Fatal("forwarded browser credentials")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.upstream)), Header: make(http.Header)}, nil
			})}
			r := completionRequest(t, "/cohorts/my"+tc.query, "user:one")
			r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, signIDToken(t, idToken{sub: tc.subject, exp: time.Now().Add(time.Hour).Unix(), kid: testSigningKeyID, typ: "jwt", key: testSigningKey(), namespace: tc.namespace, email: tc.email, emailVerified: tc.verified}))
			w := httptest.NewRecorder()
			app.handleMyCohorts(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			if tc.status == 401 || tc.status == 400 {
				if calls != 0 {
					t.Fatal("unauthorized upstream call")
				}
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
			for _, forbidden := range []string{"email_hash", "must-not-escape", "server-secret", "@"} {
				if strings.Contains(w.Body.String(), forbidden) {
					t.Fatal("response leaked identity or secret")
				}
			}
			if tc.name == "member" && strings.TrimSpace(w.Body.String()) != `{"cohorts":["A"]}` {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func TestMyCohortsDisabledAndAnonymous(t *testing.T) {
	for _, token := range []string{"", "secret"} {
		app := newTestApp(t)
		app.cohortLookupToken = token
		w := httptest.NewRecorder()
		app.handleMyCohorts(w, httptest.NewRequest("GET", "/cohorts/my", nil))
		want := 401
		if token == "" {
			want = 503
		}
		if w.Code != want {
			t.Fatalf("got %d want %d", w.Code, want)
		}
	}
}

func TestMyCohortsRejectsForgedTokenAndMethods(t *testing.T) {
	server, _ := startJWKSServer(t)
	old := signingKeysURL
	signingKeysURL = server.URL + "/api/signing-keys/keys"
	t.Cleanup(func() { signingKeysURL = old })
	app := newTestApp(t)
	app.cohortLookupToken = "secret"
	for _, method := range []string{"GET", "POST", "OPTIONS"} {
		r := completionRequest(t, "/cohorts/my", "user:one")
		r.Method = method
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyOm9uZSIsImVtYWlsIjoiYUBiLmNvbSJ9.")
		w := httptest.NewRecorder()
		app.handleMyCohorts(w, r)
		want := 405
		if method == "GET" {
			want = 401
		}
		if w.Code != want {
			t.Fatalf("%s got %d", method, w.Code)
		}
	}
}

func TestCohortConfiguration(t *testing.T) {
	instance, err := NewApp(t.Context(), backend.AppInstanceSettings{DecryptedSecureJSONData: map[string]string{"cohortLookupToken": "server-only"}})
	if err != nil {
		t.Fatal(err)
	}
	app := instance.(*App)
	if app.cohortLookupToken != "server-only" || app.cohortClient.Timeout != 5*time.Second {
		t.Fatal("missing server credential or timeout")
	}
	if app.cohortClient.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("redirects must be refused")
	}
}
