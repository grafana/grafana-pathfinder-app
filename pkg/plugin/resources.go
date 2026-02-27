package plugin

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// registerRoutes sets up the HTTP routes for the plugin.
//
// Terminal I/O Architecture (Hybrid):
// - Output: Grafana Live streaming via RunStream (see stream.go)
// - Input: HTTP POST /terminal/{vmId} (this file)
//
// Note: While the SDK supports PublishStream for bidirectional Live communication,
// Grafana's /api/live/publish endpoint blocks frontend publishing to plugin channels
// (returns 403 Forbidden). We use this HTTP endpoint for terminal input instead.
func (a *App) registerRoutes(mux *http.ServeMux) {
	// Coda registration endpoint
	mux.HandleFunc("/coda/register", a.handleCodaRegister)

	// VM management endpoints
	mux.HandleFunc("/vms", a.handleVMs)
	mux.HandleFunc("/vms/", a.handleVMByID)

	// Terminal input endpoint (required because Grafana Live blocks frontend publishing)
	mux.HandleFunc("/terminal/", a.handleTerminalInput)

	// Health check
	mux.HandleFunc("/health", a.handleHealth)
}

// handleVMs handles POST /vms (create) and GET /vms (list).
func (a *App) handleVMs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		a.handleCreateVM(w, r)
	case http.MethodGet:
		a.handleListVMs(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleVMByID handles GET/DELETE /vms/{id}.
// Terminal connections are handled via Grafana Live streaming (see stream.go).
func (a *App) handleVMByID(w http.ResponseWriter, r *http.Request) {
	// Extract VM ID from path: /vms/{id}
	path := strings.TrimPrefix(r.URL.Path, "/vms/")
	parts := strings.SplitN(path, "/", 2)
	vmID := parts[0]

	if vmID == "" {
		http.Error(w, "VM ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		a.handleGetVM(w, r, vmID)
	case http.MethodDelete:
		a.handleDeleteVM(w, r, vmID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Note: Terminal output is streamed via Grafana Live (see stream.go)
// Terminal input is sent via HTTP POST to this endpoint

// TerminalInput represents input sent to the terminal
type TerminalInput struct {
	Type string `json:"type"` // "input", "resize"
	Data string `json:"data,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Cols int    `json:"cols,omitempty"`
	User string `json:"user,omitempty"`
}

// handleTerminalInput handles POST /terminal/{vmId} for sending input to the terminal
func (a *App) handleTerminalInput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract VM ID from path: /terminal/{vmId}
	path := strings.TrimPrefix(r.URL.Path, "/terminal/")
	vmID := strings.TrimSuffix(path, "/")

	if vmID == "" {
		http.Error(w, "VM ID required", http.StatusBadRequest)
		return
	}

	// Parse input
	var input TerminalInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		a.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get user from request body (frontend source of truth for multi-tenancy),
	// falling back to X-Grafana-User header for backward compatibility
	userLogin := input.User
	if userLogin == "" {
		userLogin = r.Header.Get("X-Grafana-User")
	}
	if userLogin == "" {
		userLogin = "anonymous"
	}

	// Find session by vmID + userLogin for deterministic multi-tenant lookup
	streamSessionsMu.Lock()
	var sess *streamSession
	for _, s := range streamSessions {
		if s != nil && s.vmID == vmID && s.userLogin == userLogin {
			sess = s
			break
		}
	}
	streamSessionsMu.Unlock()

	if sess == nil || sess.session == nil {
		a.logger.Warn("No active session found for terminal input",
			"vmID", vmID,
			"requestUser", userLogin,
		)
		a.writeError(w, "No active session for VM", http.StatusNotFound)
		return
	}

	// Handle the input
	switch input.Type {
	case "input":
		if err := sess.session.Write([]byte(input.Data)); err != nil {
			a.logger.Error("Failed to write to terminal", "vmID", vmID, "error", err)
			a.writeError(w, "Failed to write to terminal", http.StatusInternalServerError)
			return
		}
	case "resize":
		if input.Rows > 0 && input.Cols > 0 {
			if err := sess.session.Resize(input.Rows, input.Cols); err != nil {
				a.logger.Error("Failed to resize terminal", "vmID", vmID, "error", err)
				a.writeError(w, "Failed to resize terminal", http.StatusInternalServerError)
				return
			}
		}
	default:
		a.writeError(w, "Unknown input type", http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// allowedHostSuffixes lists the trusted domain suffixes to prevent
// token exfiltration via user-supplied URLs. Any subdomain of these
// domains is allowed (e.g., coda.lg.grafana-dev.com, relay.lg.grafana-dev.com).
var allowedHostSuffixes = []string{
	".lg.grafana-dev.com",
	".grafana.com",
}

// isAllowedHost checks if a hostname ends with one of the allowed suffixes.
func isAllowedHost(hostname string) bool {
	for _, suffix := range allowedHostSuffixes {
		if strings.HasSuffix(hostname, suffix) {
			return true
		}
	}
	return false
}

// isAllowedCodaURL validates that a URL points to a trusted Coda API host.
func isAllowedCodaURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if u.Scheme != "https" {
		return false
	}
	return isAllowedHost(u.Hostname())
}

// IsAllowedRelayURL validates that a URL points to a trusted relay host.
// Exported for use in stream.go where relay connections are established.
func IsAllowedRelayURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if u.Scheme != "wss" {
		return false
	}
	return isAllowedHost(u.Hostname())
}

// CodaRegisterRequest represents the request body for Coda registration.
type CodaRegisterRequest struct {
	EnrollmentKey string `json:"enrollmentKey"`
	InstanceID    string `json:"instanceId"`
	InstanceURL   string `json:"instanceUrl,omitempty"`
	CodaAPIURL    string `json:"codaApiUrl"`
}

func (a *App) handleCodaRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CodaRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		a.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	enrollmentKey := req.EnrollmentKey
	if enrollmentKey == "" {
		enrollmentKey = a.settings.EnrollmentKey
	}

	if enrollmentKey == "" {
		a.writeError(w, "Enrollment key is required", http.StatusBadRequest)
		return
	}

	// Determine the Coda API URL: prefer admin-configured, fall back to request body.
	// Validate against allowlist to prevent enrollment key exfiltration via arbitrary URLs.
	codaAPIURL := a.settings.CodaAPIURL
	if codaAPIURL == "" {
		codaAPIURL = req.CodaAPIURL
	}
	if codaAPIURL == "" {
		a.writeError(w, "Coda API URL is required", http.StatusBadRequest)
		return
	}
	if !isAllowedCodaURL(codaAPIURL) {
		a.writeError(w, "Coda API URL is not a trusted host", http.StatusBadRequest)
		return
	}

	if req.InstanceID == "" {
		a.writeError(w, "Instance ID is required", http.StatusBadRequest)
		return
	}

	a.logger.Info("Registering with Coda API", "instanceId", req.InstanceID, "apiUrl", codaAPIURL)

	result, err := Register(r.Context(), codaAPIURL, enrollmentKey, req.InstanceID, req.InstanceURL)
	if err != nil {
		a.logger.Error("Failed to register with Coda", "error", err)
		if strings.Contains(err.Error(), "invalid enrollment key") {
			a.writeError(w, err.Error(), http.StatusUnauthorized)
		} else {
			a.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	a.logger.Info("Successfully registered with Coda", "instanceId", req.InstanceID, "jti", result.JTI)

	a.writeJSON(w, result, http.StatusCreated)
}

// CreateVMHTTPRequest represents the request body for creating a VM.
type CreateVMHTTPRequest struct {
	Template string `json:"template"`
}

// handleCreateVM creates a new VM via Coda.
func (a *App) handleCreateVM(w http.ResponseWriter, r *http.Request) {
	if a.coda == nil {
		a.writeError(w, "Coda not registered - configure enrollment key and register first", http.StatusServiceUnavailable)
		return
	}

	var req CreateVMHTTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		a.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Template == "" {
		req.Template = "vm-aws" // Default template
	}

	// Get user from Grafana context header
	user := r.Header.Get("X-Grafana-User")
	if user == "" {
		user = "unknown"
	}

	a.logger.Info("Creating VM", "template", req.Template, "user", user)

	vm, err := a.coda.CreateVM(r.Context(), req.Template, user)
	if err != nil {
		a.logger.Error("Failed to create VM", "error", err)
		// Check if this is an auth error
		if strings.Contains(err.Error(), "authentication failed") {
			a.writeError(w, err.Error(), http.StatusUnauthorized)
		} else {
			a.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	a.writeJSON(w, vm, http.StatusCreated)
}

// handleGetVM returns VM status and credentials.
func (a *App) handleGetVM(w http.ResponseWriter, r *http.Request, vmID string) {
	if a.coda == nil {
		a.writeError(w, "Coda not registered - configure enrollment key and register first", http.StatusServiceUnavailable)
		return
	}

	vm, err := a.coda.GetVM(r.Context(), vmID)
	if err != nil {
		a.logger.Error("Failed to get VM", "vmID", vmID, "error", err)
		if strings.Contains(err.Error(), "not found") {
			a.writeError(w, "VM not found", http.StatusNotFound)
		} else if strings.Contains(err.Error(), "authentication failed") {
			a.writeError(w, err.Error(), http.StatusUnauthorized)
		} else {
			a.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	a.writeJSON(w, vm, http.StatusOK)
}

// handleDeleteVM destroys a VM.
func (a *App) handleDeleteVM(w http.ResponseWriter, r *http.Request, vmID string) {
	if a.coda == nil {
		a.writeError(w, "Coda not registered - configure enrollment key and register first", http.StatusServiceUnavailable)
		return
	}

	// Get user from Grafana context header for authorization check
	user := r.Header.Get("X-Grafana-User")
	a.logger.Info("Deleting VM", "vmID", vmID, "user", user)

	if err := a.coda.DeleteVM(r.Context(), vmID); err != nil {
		a.logger.Error("Failed to delete VM", "vmID", vmID, "error", err)
		// Check if this is an auth error
		if strings.Contains(err.Error(), "authentication failed") {
			a.writeError(w, err.Error(), http.StatusUnauthorized)
		} else {
			a.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleListVMs returns all VMs.
func (a *App) handleListVMs(w http.ResponseWriter, r *http.Request) {
	if a.coda == nil {
		a.writeError(w, "Coda not registered - configure enrollment key and register first", http.StatusServiceUnavailable)
		return
	}

	vms, err := a.coda.ListVMs(r.Context())
	if err != nil {
		a.logger.Error("Failed to list VMs", "error", err)
		// Check if this is an auth error
		if strings.Contains(err.Error(), "authentication failed") {
			a.writeError(w, err.Error(), http.StatusUnauthorized)
		} else {
			a.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	a.writeJSON(w, map[string]interface{}{"vms": vms}, http.StatusOK)
}

// handleHealth returns the plugin health status.
func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"status":         "ok",
		"codaRegistered": a.coda != nil,
	}
	a.writeJSON(w, status, http.StatusOK)
}

// Helper functions

func (a *App) writeJSON(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		a.logger.Error("Failed to encode JSON response", "error", err)
	}
}

func (a *App) writeError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
