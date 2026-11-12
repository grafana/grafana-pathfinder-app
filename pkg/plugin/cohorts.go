package plugin

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const cohortLookupURL = "https://recommender.grafana.com/api/v1/cohorts"
const cohortResponseMaxBytes = 64 * 1024

type cohortResponse struct {
	Cohorts []string `json:"cohorts"`
}

func (a *App) handleMyCohorts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		a.writeError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.RawQuery != "" || r.ContentLength != 0 {
		a.writeError(w, "Identity parameters are not accepted", http.StatusBadRequest)
		return
	}
	if a.cohortLookupToken == "" {
		a.writeError(w, "Cohort lookup unavailable", http.StatusServiceUnavailable)
		return
	}
	email, ok := a.cohortEmail(r)
	if !ok {
		a.writeError(w, "Cloud user identity unavailable", http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(email))
	body, _ := json.Marshal(map[string]string{"email_hash": hex.EncodeToString(hash[:])})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, cohortLookupURL, bytes.NewReader(body))
	if err != nil {
		a.writeError(w, "Cohort lookup unavailable", http.StatusServiceUnavailable)
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cohortLookupToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.cohortClient.Do(req)
	if err != nil {
		a.writeError(w, "Cohort lookup unavailable", http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		a.writeError(w, "Cohort lookup unavailable", http.StatusServiceUnavailable)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, cohortResponseMaxBytes+1))
	var result cohortResponse
	if err != nil || len(data) > cohortResponseMaxBytes || json.Unmarshal(data, &result) != nil || result.Cohorts == nil {
		a.writeError(w, "Invalid cohort response", http.StatusBadGateway)
		return
	}
	a.writeJSON(w, result, http.StatusOK)
}

func (a *App) cohortEmail(r *http.Request) (string, bool) {
	token := strings.TrimSpace(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if token == "" {
		return "", false
	}
	a.cohortVerifierMu.Lock()
	if a.cohortVerifier == nil || time.Since(a.cohortVerifierCreatedAt) >= 5*time.Minute {
		// Only Cloud's authority may attest cohort identity, never a self-hosted stack.
		verifier, err := auth.NewIDTokenVerifier(signingKeysURL, "")
		if err != nil {
			a.cohortVerifierMu.Unlock()
			return "", false
		}
		a.cohortVerifier = verifier
		a.cohortVerifierCreatedAt = time.Now()
	}
	verifier := a.cohortVerifier
	a.cohortVerifierMu.Unlock()
	sub, err := verifier.Verify(r.Context(), token, backend.PluginConfigFromContext(r.Context()).Namespace)
	if err != nil || !strings.HasPrefix(sub, "user:") || len(sub) <= len("user:") {
		return "", false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", false
	}
	payload, err := decodeJWTSegment(parts[1])
	if err != nil {
		return "", false
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if json.Unmarshal(payload, &claims) != nil || !claims.EmailVerified || strings.TrimSpace(claims.Email) == "" {
		return "", false
	}
	return claims.Email, true
}
