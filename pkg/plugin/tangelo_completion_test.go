package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

const (
	syntheticTangeloToken  = "synthetic-tangelo-token-7f3a"
	syntheticTangeloUserID = "synthetic-sa-user-91c2"
	testLearnerEmail       = "learner@example.com"
	testLearnerURL         = "https://stack.example.grafana.net/a/grafana-pathfinder-app?doc=bundled%3Afirst-dashboard"
)

func tangeloSecureJSON() map[string]string {
	return map[string]string{
		"tangeloCompletionToken":                syntheticTangeloToken,
		"tangeloCompletionServiceAccountUserID": syntheticTangeloUserID,
	}
}

// tangeloReceiver is a fake Tangelo endpoint that records every call.
type tangeloReceiver struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  []tangeloCall
}

type tangeloCall struct {
	header http.Header
	body   map[string]any
}

func newTangeloReceiver(t *testing.T, status int, response string) *tangeloReceiver {
	t.Helper()
	rcv := &tangeloReceiver{}
	rcv.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		rcv.mu.Lock()
		rcv.calls = append(rcv.calls, tangeloCall{header: r.Header.Clone(), body: body})
		rcv.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(rcv.server.Close)
	return rcv
}

func (rcv *tangeloReceiver) received() []tangeloCall {
	rcv.mu.Lock()
	defer rcv.mu.Unlock()
	return append([]tangeloCall(nil), rcv.calls...)
}

// withTangeloEndpointOverride lets a test point the notifier at a fake
// receiver, as a tangelodemo build does.
func withTangeloEndpointOverride(t *testing.T) {
	t.Helper()
	prev := tangeloEndpointOverrideAllowed
	tangeloEndpointOverrideAllowed = true
	t.Cleanup(func() { tangeloEndpointOverrideAllowed = prev })
}

func withInlineTangeloDispatch(t *testing.T) {
	t.Helper()
	prev := tangeloDispatch
	tangeloDispatch = func(run func()) { run() }
	t.Cleanup(func() { tangeloDispatch = prev })
}

// newTangeloApp builds a test App from real plugin settings, so the tests cover
// the same ParseSettings → notifier path NewApp takes.
func newTangeloApp(t *testing.T, jsonData string, secure map[string]string, logger log.Logger) *App {
	t.Helper()
	settings, err := ParseSettings(backend.AppInstanceSettings{JSONData: []byte(jsonData), DecryptedSecureJSONData: secure})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	app := newTestApp(t)
	if logger != nil {
		app.logger = logger
	}
	app.tangelo = newTangeloNotifier(settings.Tangelo)
	app.tangeloStatus = tangeloStatus{
		CredentialsPresent: settings.Tangelo.credentialsPresent(),
		Enabled:            settings.Tangelo.Enabled,
	}
	return app
}

func enabledJSON(endpoint string) string {
	return fmt.Sprintf(`{"tangeloCompletionEnabled":true,"tangeloCompletionEndpoint":%q}`, endpoint)
}

func tangeloWriteBody() map[string]any {
	body := validWriteBody()
	body["pathfinderUrl"] = testLearnerURL
	return body
}

// tangeloWriteRequest is a write whose verified ID token carries an email.
func tangeloWriteRequest(t *testing.T, body map[string]any, email string) *http.Request {
	t.Helper()
	r := writeRequest(t, "user:abc", body, testGrafanaConfig())
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, signIDToken(t, idToken{
		sub: "user:abc", exp: time.Now().Add(time.Hour).Unix(), kid: testSigningKeyID, typ: "jwt",
		key: testSigningKey(), namespace: testNamespace, email: email,
	}))
	return r
}

// --- Settings ----------------------------------------------------------------

func TestParseSettings_TangeloDisabledByDefault(t *testing.T) {
	settings, err := ParseSettings(backend.AppInstanceSettings{JSONData: []byte(`{}`), DecryptedSecureJSONData: tangeloSecureJSON()})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if settings.Tangelo.Enabled {
		t.Error("Tangelo enabled without tangeloCompletionEnabled in jsonData")
	}
	if !settings.Tangelo.credentialsPresent() {
		t.Error("credentialsPresent = false with both secure keys provisioned")
	}
	if newTangeloNotifier(settings.Tangelo) != nil {
		t.Error("notifier built while the switch is off")
	}
}

func TestParseSettings_TangeloMissingCredentialDisables(t *testing.T) {
	for _, missing := range []string{"tangeloCompletionToken", "tangeloCompletionServiceAccountUserID"} {
		t.Run(missing, func(t *testing.T) {
			secure := tangeloSecureJSON()
			delete(secure, missing)
			settings, err := ParseSettings(backend.AppInstanceSettings{
				JSONData:                []byte(`{"tangeloCompletionEnabled":true}`),
				DecryptedSecureJSONData: secure,
			})
			if err != nil {
				t.Fatalf("ParseSettings: %v", err)
			}
			if settings.Tangelo.credentialsPresent() {
				t.Error("credentialsPresent = true with a key missing")
			}
			if newTangeloNotifier(settings.Tangelo) != nil {
				t.Error("notifier built with a credential missing")
			}
		})
	}
}

// jsonData belongs to the frontend; a malformed blob must neither fail
// ParseSettings nor switch the webhook on.
func TestParseSettings_MalformedJSONDataKeepsTangeloOff(t *testing.T) {
	for _, raw := range []string{`{not json`, `{"tangeloCompletionEnabled":"yes"}`} {
		settings, err := ParseSettings(backend.AppInstanceSettings{
			JSONData:                []byte(raw),
			DecryptedSecureJSONData: map[string]string{"accessToken": "cap-token", "tangeloCompletionToken": "x", "tangeloCompletionServiceAccountUserID": "y"},
		})
		if err != nil {
			t.Fatalf("ParseSettings(%s): %v", raw, err)
		}
		if settings.Tangelo.Enabled {
			t.Errorf("ParseSettings(%s): Tangelo enabled", raw)
		}
		if settings.OBOToken != "cap-token" {
			t.Errorf("ParseSettings(%s): OBO token lost", raw)
		}
	}
}

func TestParseSettings_TangeloSecretsNeverSerialize(t *testing.T) {
	settings, err := ParseSettings(backend.AppInstanceSettings{
		JSONData:                []byte(`{"tangeloCompletionEnabled":true}`),
		DecryptedSecureJSONData: tangeloSecureJSON(),
	})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	assertNoTangeloSecret(t, "marshalled settings", string(raw))
}

// Release builds post only to the fixed endpoint, whatever jsonData says.
func TestTangeloEndpointFixedOutsideDemoBuild(t *testing.T) {
	n := newTangeloNotifier(tangeloSettings{
		Enabled: true, Token: "t", ServiceAccountUserID: "u", EndpointOverride: "http://127.0.0.1:1/elsewhere",
	})
	if n == nil {
		t.Fatal("notifier not built")
	}
	if n.endpoint != tangeloCompletionEndpoint {
		t.Errorf("endpoint = %q, want %q", n.endpoint, tangeloCompletionEndpoint)
	}
}

// --- Webhook on the write path ----------------------------------------------

func TestTangeloWebhook_EnabledHappyPath(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withCreator(t, &fakeCreator{})
	withTangeloEndpointOverride(t)
	withInlineTangeloDispatch(t)
	rcv := newTangeloReceiver(t, http.StatusOK, `{"status":"completed"}`)
	app := newTangeloApp(t, enabledJSON(rcv.server.URL+"/api/v1/task_completions"), tangeloSecureJSON(), nil)

	body := tangeloWriteBody()
	body["completedAt"] = time.Unix(1_700_000_000, 0).In(time.FixedZone("CET", 3600)).Format(time.RFC3339)
	rec := doWrite(t, app, tangeloWriteRequest(t, body, testLearnerEmail))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	calls := rcv.received()
	if len(calls) != 1 {
		t.Fatalf("Tangelo received %d calls, want 1", len(calls))
	}
	call := calls[0]
	if got := call.header.Get("Authorization"); got != "Bearer "+syntheticTangeloToken {
		t.Errorf("Authorization = %q, want the bearer token", got)
	}
	if got := call.header.Get("X-User-Id"); got != syntheticTangeloUserID {
		t.Errorf("X-User-Id = %q, want the service-account user id", got)
	}
	if got := call.header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	want := map[string]any{
		"employee_email":  testLearnerEmail,
		"path_finder_url": testLearnerURL,
		"completed_at":    "2023-11-14T22:13:20Z",
	}
	if len(call.body) != len(want) {
		t.Errorf("body = %v, want exactly %v", call.body, want)
	}
	for k, v := range want {
		if call.body[k] != v {
			t.Errorf("body[%s] = %v, want %v", k, call.body[k], v)
		}
	}
}

// The email is the verified token's, never a value the client puts in the body.
func TestTangeloWebhook_EmailComesFromVerifiedIdentity(t *testing.T) {
	withCreator(t, &fakeCreator{})
	withTangeloEndpointOverride(t)
	withInlineTangeloDispatch(t)
	rcv := newTangeloReceiver(t, http.StatusOK, `{}`)
	app := newTangeloApp(t, enabledJSON(rcv.server.URL), tangeloSecureJSON(), nil)

	body := tangeloWriteBody()
	body["employee_email"] = "attacker@example.com"
	body["email"] = "attacker@example.com"
	rec := doWrite(t, app, tangeloWriteRequest(t, body, testLearnerEmail))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	calls := rcv.received()
	if len(calls) != 1 || calls[0].body["employee_email"] != testLearnerEmail {
		t.Fatalf("calls = %v, want one call carrying the token's email", calls)
	}
}

func TestTangeloWebhook_NotSent(t *testing.T) {
	tests := []struct {
		name     string
		jsonData string
		secure   map[string]string
		body     func() map[string]any
		email    string
	}{
		{"disabled by default", `{}`, tangeloSecureJSON(), tangeloWriteBody, testLearnerEmail},
		{"switched off", `{"tangeloCompletionEnabled":false}`, tangeloSecureJSON(), tangeloWriteBody, testLearnerEmail},
		{"credentials missing", "", map[string]string{}, tangeloWriteBody, testLearnerEmail},
		{"identity has no email", "", tangeloSecureJSON(), tangeloWriteBody, ""},
		{"no pathfinderUrl", "", tangeloSecureJSON(), validWriteBody, testLearnerEmail},
		{"relative pathfinderUrl", "", tangeloSecureJSON(), func() map[string]any {
			b := tangeloWriteBody()
			b["pathfinderUrl"] = "/a/grafana-pathfinder-app"
			return b
		}, testLearnerEmail},
		{"non-http pathfinderUrl", "", tangeloSecureJSON(), func() map[string]any {
			b := tangeloWriteBody()
			b["pathfinderUrl"] = "javascript:alert(1)"
			return b
		}, testLearnerEmail},
		{"pathfinderUrl with credentials", "", tangeloSecureJSON(), func() map[string]any {
			b := tangeloWriteBody()
			b["pathfinderUrl"] = "https://user:pass@stack.example.grafana.net/"
			return b
		}, testLearnerEmail},
		{"oversized pathfinderUrl", "", tangeloSecureJSON(), func() map[string]any {
			b := tangeloWriteBody()
			b["pathfinderUrl"] = "https://stack.example.grafana.net/" + strings.Repeat("a", tangeloMaxURLLen)
			return b
		}, testLearnerEmail},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			withCreator(t, &fakeCreator{})
			withTangeloEndpointOverride(t)
			withInlineTangeloDispatch(t)
			rcv := newTangeloReceiver(t, http.StatusOK, `{}`)
			jsonData := tc.jsonData
			if jsonData == "" {
				jsonData = enabledJSON(rcv.server.URL)
			}
			app := newTangeloApp(t, jsonData, tc.secure, nil)

			rec := doWrite(t, app, tangeloWriteRequest(t, tc.body(), tc.email))
			if rec.Code != http.StatusCreated {
				t.Fatalf("completion status = %d, want 201 (the webhook must never change the write)", rec.Code)
			}
			if n := len(rcv.received()); n != 0 {
				t.Errorf("Tangelo received %d calls, want 0", n)
			}
		})
	}
}

// A completion that did not become durable is never reported.
func TestTangeloWebhook_NotSentWhenWriteFails(t *testing.T) {
	withCreator(t, &fakeCreator{err: &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "down"}})
	withTangeloEndpointOverride(t)
	withInlineTangeloDispatch(t)
	rcv := newTangeloReceiver(t, http.StatusOK, `{}`)
	app := newTangeloApp(t, enabledJSON(rcv.server.URL), tangeloSecureJSON(), nil)

	rec := doWrite(t, app, tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if n := len(rcv.received()); n != 0 {
		t.Errorf("Tangelo received %d calls, want 0", n)
	}
}

// A 409 replay is the record's own earlier write; Tangelo answers a repeat with
// already_completed, so resending is safe and recovers a lost first send.
func TestTangeloWebhook_SentOnIdempotentReplay(t *testing.T) {
	withCreator(t, &fakeCreator{err: &appPlatformUpstreamError{status: http.StatusConflict, msg: "exists"}})
	withTangeloEndpointOverride(t)
	withInlineTangeloDispatch(t)
	rcv := newTangeloReceiver(t, http.StatusOK, `{"status":"already_completed"}`)
	app := newTangeloApp(t, enabledJSON(rcv.server.URL), tangeloSecureJSON(), nil)

	rec := doWrite(t, app, tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	if n := len(rcv.received()); n != 1 {
		t.Errorf("Tangelo received %d calls, want 1", n)
	}
}

func TestTangeloWebhook_FailureDoesNotAffectCompletion(t *testing.T) {
	baseline := func(t *testing.T) *httptest.ResponseRecorder {
		withCreator(t, &fakeCreator{})
		return doWrite(t, newTestApp(t), tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))
	}

	for _, tc := range []struct {
		name     string
		endpoint func(t *testing.T) string
	}{
		{"rejected 500", func(t *testing.T) string {
			return newTangeloReceiver(t, http.StatusInternalServerError, `{"error":"boom"}`).server.URL
		}},
		{"rejected 401", func(t *testing.T) string {
			return newTangeloReceiver(t, http.StatusUnauthorized, `{"error":"bad credentials"}`).server.URL
		}},
		{"unreachable", func(t *testing.T) string {
			srv := httptest.NewServer(http.NotFoundHandler())
			srv.Close()
			return srv.URL
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withFrozenTime(t, time.Unix(1_700_000_000, 0))
			want := baseline(t)

			withCreator(t, &fakeCreator{})
			withTangeloEndpointOverride(t)
			withInlineTangeloDispatch(t)
			app := newTangeloApp(t, enabledJSON(tc.endpoint(t)), tangeloSecureJSON(), nil)
			got := doWrite(t, app, tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))

			if got.Code != want.Code || got.Body.String() != want.Body.String() {
				t.Errorf("completion response = %d %s, want %d %s", got.Code, got.Body.String(), want.Code, want.Body.String())
			}
			if got.Header().Get("Retry-After") != "" {
				t.Error("Tangelo failure set Retry-After on the completion response")
			}
		})
	}
}

// The send runs off the request path: a Tangelo that hangs does not hold the
// completion response.
func TestTangeloWebhook_DoesNotBlockCompletion(t *testing.T) {
	withCreator(t, &fakeCreator{})
	withTangeloEndpointOverride(t)
	release := make(chan struct{})
	arrived := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		arrived <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) })
	app := newTangeloApp(t, enabledJSON(srv.URL), tangeloSecureJSON(), nil)

	r := tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- doWrite(t, app, r) }()

	select {
	case rec := <-done:
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("completion response waited on Tangelo")
	}
	select {
	case <-arrived:
	case <-time.After(3 * time.Second):
		t.Fatal("Tangelo never received the background send")
	}
}

func TestTangeloWebhook_DoesNotFollowRedirects(t *testing.T) {
	withCreator(t, &fakeCreator{})
	withTangeloEndpointOverride(t)
	withInlineTangeloDispatch(t)
	elsewhere := newTangeloReceiver(t, http.StatusOK, `{}`)
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.server.URL, http.StatusTemporaryRedirect)
	}))
	t.Cleanup(redirector.Close)
	app := newTangeloApp(t, enabledJSON(redirector.URL), tangeloSecureJSON(), nil)

	doWrite(t, app, tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))
	if n := len(elsewhere.received()); n != 0 {
		t.Errorf("redirect target received %d calls carrying the bearer token, want 0", n)
	}
}

// --- Secrets never leak -----------------------------------------------------

// argsLogger records every message together with its key/value arguments.
type argsLogger struct {
	mu    *sync.Mutex
	lines *[]string
}

func newArgsLogger() argsLogger { return argsLogger{mu: &sync.Mutex{}, lines: &[]string{}} }

func (l argsLogger) record(level, msg string, args ...interface{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	*l.lines = append(*l.lines, fmt.Sprint(level, " ", msg, " ", args))
}

func (l argsLogger) all() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(*l.lines, "\n")
}

func (l argsLogger) Debug(msg string, args ...interface{})    { l.record("debug", msg, args...) }
func (l argsLogger) Info(msg string, args ...interface{})     { l.record("info", msg, args...) }
func (l argsLogger) Warn(msg string, args ...interface{})     { l.record("warn", msg, args...) }
func (l argsLogger) Error(msg string, args ...interface{})    { l.record("error", msg, args...) }
func (l argsLogger) With(args ...interface{}) log.Logger      { return l }
func (l argsLogger) Level() log.Level                         { return log.Debug }
func (l argsLogger) FromContext(_ context.Context) log.Logger { return l }

func assertNoTangeloSecret(t *testing.T, where, text string) {
	t.Helper()
	for _, secret := range []string{syntheticTangeloToken, syntheticTangeloUserID} {
		if strings.Contains(text, secret) {
			t.Errorf("%s contains a Tangelo secret: %s", where, text)
		}
	}
}

func TestTangeloWebhook_SecretsNeverInResponsesOrLogs(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
	}{
		{"accepted", http.StatusOK},
		{"rejected", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withCreator(t, &fakeCreator{})
			withTangeloEndpointOverride(t)
			withInlineTangeloDispatch(t)
			// A hostile or buggy upstream echoing the credentials back must not
			// get them into the log either.
			rcv := newTangeloReceiver(t, tc.status,
				fmt.Sprintf(`{"status":%q,"detail":%q}`, syntheticTangeloToken, syntheticTangeloUserID))
			logger := newArgsLogger()
			app := newTangeloApp(t, enabledJSON(rcv.server.URL), tangeloSecureJSON(), logger)

			rec := doWrite(t, app, tangeloWriteRequest(t, tangeloWriteBody(), testLearnerEmail))
			if len(rcv.received()) != 1 {
				t.Fatalf("Tangelo received %d calls, want 1", len(rcv.received()))
			}
			assertNoTangeloSecret(t, "completion response", rec.Body.String()+fmt.Sprint(rec.Header()))
			assertNoTangeloSecret(t, "log output", logger.all())
			if !strings.Contains(logger.all(), fmt.Sprint(tc.status)) {
				t.Errorf("log output does not record the outcome status %d: %s", tc.status, logger.all())
			}

			status := httptest.NewRecorder()
			app.handleTangeloStatus(status, tangeloStatusRequest(t, "Admin"))
			assertNoTangeloSecret(t, "status response", status.Body.String())
		})
	}
}

// --- Status resource --------------------------------------------------------

func tangeloStatusRequest(t *testing.T, role string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/tangelo-integration/status", nil)
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{User: &backend.User{Role: role}})
	return r.WithContext(ctx)
}

func TestTangeloStatus(t *testing.T) {
	tests := []struct {
		name     string
		jsonData string
		secure   map[string]string
		want     tangeloStatus
	}{
		{"defaults", `{}`, nil, tangeloStatus{}},
		{"provisioned but off", `{}`, tangeloSecureJSON(), tangeloStatus{CredentialsPresent: true}},
		{"on without credentials", `{"tangeloCompletionEnabled":true}`, nil, tangeloStatus{Enabled: true}},
		{"on and provisioned", `{"tangeloCompletionEnabled":true}`, tangeloSecureJSON(), tangeloStatus{CredentialsPresent: true, Enabled: true}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := newTangeloApp(t, tc.jsonData, tc.secure, nil)
			rec := httptest.NewRecorder()
			app.handleTangeloStatus(rec, tangeloStatusRequest(t, "Admin"))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var got map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			want := map[string]any{"credentialsPresent": tc.want.CredentialsPresent, "enabled": tc.want.Enabled}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Errorf("body = %v, want exactly %v", got, want)
			}
		})
	}
}

func TestTangeloStatus_AdminOnly(t *testing.T) {
	app := newTangeloApp(t, `{}`, tangeloSecureJSON(), nil)
	for _, role := range []string{"Viewer", "Editor", ""} {
		rec := httptest.NewRecorder()
		app.handleTangeloStatus(rec, tangeloStatusRequest(t, role))
		if rec.Code != http.StatusForbidden {
			t.Errorf("role %q: status = %d, want 403", role, rec.Code)
		}
	}
}

func TestTangeloStatus_Routed(t *testing.T) {
	app := newTangeloApp(t, `{}`, nil, nil)
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, tangeloStatusRequest(t, "Admin"))
	if rec.Code != http.StatusOK {
		t.Errorf("GET /tangelo-integration/status = %d, want 200", rec.Code)
	}
}
