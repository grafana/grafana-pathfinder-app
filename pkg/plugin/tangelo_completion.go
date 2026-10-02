package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Tangelo completion webhook (exploratory prototype, not for production).
//
// After a durable completion record is written, the plugin tells Tangelo, an
// external learning platform, that the learner finished the lab they were on.
// Tangelo matches its own task by path_finder_url and treats a repeat for the
// same learner and lab as already_completed, so a duplicate send is harmless.
//
// The call is best-effort and fire-and-forget: it never blocks, fails, or
// changes the completion-write response, and a failed send is logged and lost
// (no durable retry queue).
//
// The two credentials are per-stack secureJsonData, read in ParseSettings. They
// must never reach a response body, a log line, an error message, or jsonData.

// tangeloCompletionEndpoint is fixed: only builds tagged tangelodemo can point
// the webhook anywhere else (tangelo_demo.go).
const tangeloCompletionEndpoint = "https://backend.tangelo.ai/api/v1/task_completions"

const (
	tangeloCompletionTimeout = 5 * time.Second

	// tangeloMaxURLLen bounds the client-supplied pathfinderUrl.
	tangeloMaxURLLen = 2048

	tangeloMaxResponseBytes = 4 * 1024
)

// tangeloEndpointOverrideAllowed is set only by tangelo_demo.go.
var tangeloEndpointOverrideAllowed = false

// tangeloDispatch runs the send off the request path. Tests replace it to run
// the send inline.
var tangeloDispatch = func(run func()) { go run() }

// tangeloResultPattern accepts a short machine token such as "completed" or
// "already_completed" from Tangelo's response body, so the log line can carry
// it without echoing arbitrary upstream content.
var tangeloResultPattern = regexp.MustCompile(`^[a-z_]{1,32}$`)

type tangeloNotifier struct {
	endpoint             string
	token                string
	serviceAccountUserID string
	client               *http.Client
}

// newTangeloNotifier returns nil unless the integration is switched on and both
// credentials are provisioned.
func newTangeloNotifier(s tangeloSettings) *tangeloNotifier {
	if !s.active() {
		return nil
	}
	endpoint := tangeloCompletionEndpoint
	if tangeloEndpointOverrideAllowed && s.EndpointOverride != "" {
		endpoint = s.EndpointOverride
	}
	return &tangeloNotifier{
		endpoint:             endpoint,
		token:                s.Token,
		serviceAccountUserID: s.ServiceAccountUserID,
		client: &http.Client{
			Timeout: tangeloCompletionTimeout,
			// A redirect would replay the bearer token to wherever it points.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

type tangeloCompletionBody struct {
	EmployeeEmail string `json:"employee_email"`
	PathFinderURL string `json:"path_finder_url"`
	CompletedAt   string `json:"completed_at,omitempty"`
}

// notifyTangeloCompletion sends the completion to Tangelo in the background. It
// returns immediately and never reports failure to the caller. The email comes
// from the caller's verified ID token, never from the request body.
func (a *App) notifyTangeloCompletion(r *http.Request, pathfinderURL, completedAt string) {
	if a.tangelo == nil {
		return
	}
	logger := a.ctxLogger(r.Context())
	email := idTokenEmail(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if email == "" {
		logger.Info("tangelo completion skipped: verified identity carries no email")
		return
	}
	learnerURL, ok := normalizeTangeloURL(pathfinderURL)
	if !ok {
		logger.Info("tangelo completion skipped: no usable pathfinderUrl on the completion")
		return
	}
	body := tangeloCompletionBody{EmployeeEmail: email, PathFinderURL: learnerURL}
	if t, ok := parseCompletionTime(completedAt); ok {
		body.CompletedAt = t.UTC().Format(time.RFC3339)
	}
	ctx := context.WithoutCancel(r.Context())
	tangeloDispatch(func() { a.tangelo.send(ctx, body, logger) })
}

func (n *tangeloNotifier) send(ctx context.Context, body tangeloCompletionBody, logger log.Logger) {
	ctx, cancel := context.WithTimeout(ctx, tangeloCompletionTimeout)
	defer cancel()

	payload, err := json.Marshal(body)
	if err != nil {
		logger.Warn("tangelo completion not sent: encoding failed")
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.endpoint, bytes.NewReader(payload))
	if err != nil {
		logger.Warn("tangelo completion not sent: request could not be built")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+n.token)
	req.Header.Set("X-User-Id", n.serviceAccountUserID)

	resp, err := n.client.Do(req)
	if err != nil {
		// The error text can name the endpoint but never carries the headers; it
		// is still withheld so no transport detail leaks into the log.
		logger.Warn("tangelo completion failed: no response")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	result := tangeloResult(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		logger.Info("tangelo completion sent", "status", resp.StatusCode, "result", result)
		return
	}
	logger.Warn("tangelo completion rejected", "status", resp.StatusCode, "result", result)
}

// tangeloResult extracts a bounded status token from a Tangelo response body,
// or "" when the body has none.
func tangeloResult(r io.Reader) string {
	var parsed struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(r, tangeloMaxResponseBytes)).Decode(&parsed); err != nil {
		return ""
	}
	if !tangeloResultPattern.MatchString(parsed.Status) {
		return ""
	}
	return parsed.Status
}

// normalizeTangeloURL accepts an absolute http(s) URL without embedded
// credentials, within tangeloMaxURLLen.
func normalizeTangeloURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > tangeloMaxURLLen {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", false
	}
	return u.String(), true
}

// idTokenEmail reads the `email` claim from an already-verified ID token. Like
// idTokenProfile it gates nothing and returns "" on any decode failure.
func idTokenEmail(token string) string {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := decodeJWTSegment(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	return strings.TrimSpace(claims.Email)
}

// tangeloStatus is the GET /tangelo-integration/status envelope. It carries
// booleans only: whether the secrets exist, never what they are.
type tangeloStatus struct {
	CredentialsPresent bool `json:"credentialsPresent"`
	Enabled            bool `json:"enabled"`
}

// handleTangeloStatus serves GET /tangelo-integration/status to org admins, the
// only users who can see the config page.
func (a *App) handleTangeloStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	user := backend.PluginConfigFromContext(r.Context()).User
	if user == nil || user.Role != "Admin" {
		a.writeError(w, "forbidden", http.StatusForbidden)
		return
	}
	a.writeJSON(w, a.tangeloStatus, http.StatusOK)
}
