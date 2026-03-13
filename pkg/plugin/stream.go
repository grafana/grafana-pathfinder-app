// Package plugin implements the Grafana Pathfinder app plugin backend.
//
// Terminal Streaming Architecture (Bidirectional Grafana Live):
//
//	┌─────────────┐                      ┌─────────────┐
//	│   Frontend  │                      │   Backend   │
//	│  (xterm.js) │                      │  (Go/SSH)   │
//	└──────┬──────┘                      └──────┬──────┘
//	       │                                    │
//	       │  ── PublishStream ──────────────► │  (keyboard input, resize)
//	       │                                    │
//	       │  ◄──── RunStream ─────────────── │  (SSH output, status)
//	       │                                    │
//
// Both directions use a single Grafana Live WebSocket connection.
//
// Handler Responsibilities:
// - SubscribeStream: Authorizes subscription, validates VM exists
// - PublishStream: Receives terminal input from the frontend (keyboard, resize)
// - RunStream: Establishes SSH connection, streams output to frontend
package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Ensure App implements StreamHandler (bidirectional streaming)
var _ backend.StreamHandler = (*App)(nil)

// streamSession holds an active terminal streaming session
type streamSession struct {
	vmID      string
	userLogin string
	session   *TerminalSession
	sender    *backend.StreamSender
	cancel    context.CancelFunc
}

// streamSessions is managed on the App instance (see app.go)

// userVMs is managed on the App instance (see app.go)

// getUserLogin extracts the user login from a RunStreamRequest.
// Falls back to "anonymous" if user info is not available.
func getUserLogin(req *backend.RunStreamRequest) string {
	if req.PluginContext.User != nil && req.PluginContext.User.Login != "" {
		return req.PluginContext.User.Login
	}
	return "anonymous"
}

// TerminalStreamOutput represents output messages to the frontend
type TerminalStreamOutput struct {
	Type    string `json:"type"` // "output", "error", "connected", "disconnected", "status"
	Data    string `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
	State   string `json:"state,omitempty"`   // VM state for "status" type: "pending", "provisioning", "active"
	Message string `json:"message,omitempty"` // Human-readable status message
	VmId    string `json:"vmId,omitempty"`    // Actual VM ID being used (sent with "connected" and "status")
}

// SubscribeStream is called when a client wants to subscribe to a stream.
// Channel path format: terminal/{vmId} or terminal/{vmId}/{nonce}
// The optional nonce allows frontend to force new streams on reconnect.
// Special vmId values:
//   - "new": Backend will provision a fresh VM in RunStream
//   - Any other value: Treated as existing VM ID (will be validated/replaced in RunStream)
func (a *App) SubscribeStream(ctx context.Context, req *backend.SubscribeStreamRequest) (*backend.SubscribeStreamResponse, error) {
	ctxLogger := a.ctxLogger(ctx)
	ctxLogger.Info("SubscribeStream called", "path", req.Path)

	// Parse channel path: terminal/{vmId} or terminal/{vmId}/{nonce}
	parts := strings.Split(req.Path, "/")
	if len(parts) < 2 || parts[0] != "terminal" {
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	vmID := parts[1]

	// Check if Coda is configured (has JWT token)
	if a.coda == nil {
		ctxLogger.Error("Coda not registered for stream subscription")
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	// Allow "new" vmId - RunStream will provision a fresh VM
	if vmID == "new" || vmID == "" {
		ctxLogger.Info("Stream subscription accepted for new VM provisioning")
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	// For existing vmId, verify VM exists (allow pending/provisioning VMs - RunStream will wait)
	// If VM doesn't exist or is invalid, RunStream will handle provisioning a replacement
	vm, err := a.coda.GetVM(ctx, vmID)
	if err != nil {
		// VM not found - still accept, RunStream will provision a new one
		ctxLogger.Info("VM not found, will provision in RunStream", "vmID", vmID)
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	// Only reject destroyed or error states at subscription time for better UX
	// (avoids immediate subscription failure for expired VMs - RunStream handles replacement)
	if vm.State == "destroyed" || vm.State == "destroying" || vm.State == "error" {
		ctxLogger.Info("VM in terminal state, will provision replacement in RunStream", "vmID", vmID, "state", vm.State)
		// Still accept - RunStream will handle provisioning a replacement
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	ctxLogger.Info("Stream subscription accepted", "vmID", vmID, "state", vm.State)

	return &backend.SubscribeStreamResponse{
		Status: backend.SubscribeStreamStatusOK,
	}, nil
}

// TerminalInput represents input sent to the terminal from the frontend via PublishStream.
type TerminalInput struct {
	Type string `json:"type"` // "input", "resize"
	Data string `json:"data,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Cols int    `json:"cols,omitempty"`
}

// PublishStream is called when a client publishes a message to a stream.
// This handles terminal input from the frontend (keyboard input, resize events)
// over the same Grafana Live WebSocket used for output streaming.
func (a *App) PublishStream(ctx context.Context, req *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	ctxLogger := a.ctxLogger(ctx)
	ctxLogger.Debug("PublishStream called", "path", req.Path, "dataLen", len(req.Data))

	// Parse channel path: terminal/{vmId} or terminal/{vmId}/{nonce}
	parts := strings.Split(req.Path, "/")
	if len(parts) < 2 || parts[0] != "terminal" {
		ctxLogger.Warn("PublishStream: invalid path", "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	vmID := parts[1]

	// Look up the active session by channel path
	a.streamSessionsMu.Lock()
	sess, exists := a.streamSessions[req.Path]
	a.streamSessionsMu.Unlock()

	if !exists || sess == nil || sess.session == nil {
		ctxLogger.Warn("PublishStream: no active session", "vmID", vmID, "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	// Parse the input message
	var input TerminalInput
	if err := json.Unmarshal(req.Data, &input); err != nil {
		ctxLogger.Error("PublishStream: failed to parse input", "error", err, "data", string(req.Data))
		return nil, fmt.Errorf("invalid terminal input: %w", err)
	}

	// Handle the message
	switch input.Type {
	case "input":
		if err := sess.session.Write([]byte(input.Data)); err != nil {
			ctxLogger.Error("PublishStream: failed to write to SSH", "vmID", vmID, "error", err)
		} else {
			ctxLogger.Debug("PublishStream: wrote input to SSH", "vmID", vmID, "dataLen", len(input.Data))
		}
	case "resize":
		if input.Rows > 0 && input.Cols > 0 {
			if err := sess.session.Resize(input.Rows, input.Cols); err != nil {
				ctxLogger.Error("PublishStream: failed to resize terminal", "vmID", vmID, "error", err)
			} else {
				ctxLogger.Debug("PublishStream: resized terminal", "vmID", vmID, "rows", input.Rows, "cols", input.Cols)
			}
		}
	default:
		ctxLogger.Warn("PublishStream: unknown input type", "type", input.Type)
	}

	return &backend.PublishStreamResponse{
		Status: backend.PublishStreamStatusOK,
	}, nil
}

// sendStreamError sends an error message to the frontend via the stream
func sendStreamError(sender *backend.StreamSender, errMsg string) {
	output := TerminalStreamOutput{
		Type:  "error",
		Error: errMsg,
	}
	jsonBytes, _ := json.Marshal(output)
	frame := data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
	_ = sender.SendFrame(frame, data.IncludeAll)
}

// sendStreamStatusWithVmId sends a VM provisioning status update with the VM ID
func sendStreamStatusWithVmId(sender *backend.StreamSender, state string, message string, vmId string) {
	output := TerminalStreamOutput{
		Type:    "status",
		State:   state,
		Message: message,
		VmId:    vmId,
	}
	jsonBytes, _ := json.Marshal(output)
	frame := data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
	_ = sender.SendFrame(frame, data.IncludeAll)
}

// statusMessageForState returns a human-readable message for a VM state
func statusMessageForState(state string) string {
	switch state {
	case "pending":
		return "Waiting in queue..."
	case "provisioning":
		return "VM is booting..."
	case "active":
		return "VM is ready"
	default:
		return fmt.Sprintf("VM state: %s", state)
	}
}

// isSSHAuthError checks if an error is an SSH authentication failure
func isSSHAuthError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "ssh authentication failed") ||
		strings.Contains(errStr, "auth_failed") ||
		strings.Contains(errStr, "could not authenticate") ||
		strings.Contains(errStr, "ssh handshake") ||
		strings.Contains(errStr, "unable to authenticate") ||
		strings.Contains(errStr, "permission denied")
}

// isSSHRetryableError checks if an error is retryable on the same VM
// (timeouts, connection issues). Auth failures are NOT retryable on the
// same VM -- they trigger provisioning a fresh VM instead.
func isSSHRetryableError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "no route to host") ||
		strings.Contains(errStr, "i/o timeout") ||
		strings.Contains(errStr, "eof") ||
		strings.Contains(errStr, "broken pipe")
}

// SSH retry constants
const (
	maxSSHRetries         = 3                // SSH connection retries on the same VM
	maxCredentialRefreshes = 2               // Times to re-fetch credentials on auth failure before giving up
	sshRetryDelay         = 5 * time.Second  // Delay between same-VM retries
	maxUserVMs            = 3                // Hard limit on non-terminal VMs per user
)

// waitForVMActive polls until VM is active and returns it, sending status updates
func (a *App) waitForVMActive(ctx context.Context, sender *backend.StreamSender, vmID string) (*VM, error) {
	ctxLogger := a.ctxLogger(ctx)
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	maxAttempts := 60 // 3 minutes max wait
	for attempts := 0; attempts < maxAttempts; attempts++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
			vm, err := a.coda.GetVM(ctx, vmID)
			if err != nil {
				ctxLogger.Warn("Failed to poll VM status", "vmID", vmID, "error", err)
				continue
			}

			if vm.State == "error" {
				errMsg := "VM provisioning failed"
				if vm.ErrorMessage != nil {
					errMsg = fmt.Sprintf("VM provisioning failed: %s", *vm.ErrorMessage)
				}
				sendStreamError(sender, errMsg)
				return nil, errors.New(errMsg)
			}
			if vm.State == "destroyed" || vm.State == "destroying" {
				errMsg := "VM was destroyed"
				sendStreamError(sender, errMsg)
				return nil, errors.New(errMsg)
			}

			sendStreamStatusWithVmId(sender, vm.State, statusMessageForState(vm.State), vmID)

			if vm.State == "active" && vm.Credentials != nil {
				return vm, nil
			}
		}
	}

	errMsg := "timeout waiting for VM to become active"
	sendStreamError(sender, errMsg)
	return nil, errors.New(errMsg)
}

// vmRequestOpts holds optional template and config overrides for VM creation.
// When template is empty, the default "vm-aws" is used.
type vmRequestOpts struct {
	template string
	config   map[string]interface{}
}

func (o vmRequestOpts) appName() string {
	if o.config == nil {
		return ""
	}
	if app, ok := o.config["app"].(string); ok {
		return app
	}
	return ""
}

// resolveVMForUser finds or creates a VM for the given user.
//
// Priority:
//  1. In-memory fast path -- check userVMs cache, validate with GetVM (retry transient errors once).
//  2. ListVMs fallback   -- if cache miss or 404, query the Coda API for active VMs owned by user.
//  3. Create last resort  -- if no usable VM exists, check quota then CreateVM.
//
// When opts specifies a non-default template, cached and existing VMs with a
// different template are skipped so the user gets the right VM type.
//
// Terminal-state VMs found during resolution are destroyed (best-effort).
func (a *App) resolveVMForUser(ctx context.Context, sender *backend.StreamSender, userLogin string, opts ...vmRequestOpts) (*VM, string, error) {
	ctxLogger := a.ctxLogger(ctx)

	// Resolve requested template (default: vm-aws)
	requestedTemplate := "vm-aws"
	var vmConfig map[string]interface{}
	var requestedApp string
	if len(opts) > 0 && opts[0].template != "" {
		requestedTemplate = opts[0].template
		vmConfig = opts[0].config
		requestedApp = opts[0].appName()
	}

	ctxLogger.Info("Resolving VM for user", "userLogin", userLogin, "template", requestedTemplate, "app", requestedApp)

	// VMs queued for deletion due to template/app mismatch. We must wait for
	// these to complete before the quota check so CountVMsForUser sees accurate
	// counts and doesn't spuriously reject creation.
	var mismatchVMsToDelete []string

	// Step 1: In-memory fast path
	a.userVMsMu.RLock()
	cachedID, hasCached := a.userVMs[userLogin]
	a.userVMsMu.RUnlock()

	if hasCached {
		ctxLogger.Info("Found cached VM for user", "userLogin", userLogin, "vmID", cachedID)
		vm, err := a.getVMWithRetry(ctx, cachedID)

		if err != nil && !isVMNotFoundError(err) {
			ctxLogger.Warn("Cached VM fetch failed (transient), falling back to ListVMs", "vmID", cachedID, "error", err)
		} else if err != nil {
			ctxLogger.Info("Cached VM no longer exists, clearing", "vmID", cachedID)
			a.clearUserVM(userLogin, cachedID)
		} else if isUsableState(vm.State) {
			templateMismatch := vm.Template != requestedTemplate
			appMismatch := requestedApp != "" && vm.AppName() != requestedApp

			if templateMismatch || appMismatch {
				ctxLogger.Info("Cached VM doesn't match request, destroying and creating fresh",
					"vmID", cachedID, "cachedTemplate", vm.Template, "cachedApp", vm.AppName(),
					"requestedTemplate", requestedTemplate, "requestedApp", requestedApp)
				a.clearUserVM(userLogin, cachedID)
				sendStreamStatusWithVmId(sender, "replacing", "Switching to a different app, replacing VM...", cachedID)
				mismatchVMsToDelete = append(mismatchVMsToDelete, cachedID)
			} else {
				ctxLogger.Info("Reusing cached VM", "userLogin", userLogin, "vmID", cachedID, "state", vm.State)
				sendStreamStatusWithVmId(sender, vm.State, "Reconnecting to your existing VM...", cachedID)
				return vm, cachedID, nil
			}
		} else {
			ctxLogger.Info("Cached VM in terminal state, destroying", "vmID", cachedID, "state", vm.State)
			a.clearUserVM(userLogin, cachedID)
			go func() { _ = a.coda.DeleteVM(context.Background(), cachedID, true) }()
		}
	}

	// Step 2: ListVMs fallback -- ask Coda for the user's VMs
	ctxLogger.Info("Querying Coda for existing VMs", "userLogin", userLogin)
	sendStreamStatusWithVmId(sender, "checking", "Looking for your existing VM...", "")

	existingVM, surplusVMs, err := a.coda.FindActiveVMForUser(ctx, userLogin)
	if err != nil {
		ctxLogger.Warn("FindActiveVMForUser failed, proceeding to create", "error", err)
	}
	if existingVM != nil {
		templateMatch := existingVM.Template == requestedTemplate
		appMatch := requestedApp == "" || existingVM.AppName() == requestedApp

		if templateMatch && appMatch {
			ctxLogger.Info("Found existing VM via ListVMs", "vmID", existingVM.ID, "state", existingVM.State, "surplusCount", len(surplusVMs))
			a.userVMsMu.Lock()
			a.userVMs[userLogin] = existingVM.ID
			a.userVMsMu.Unlock()

			if len(surplusVMs) > 0 {
				ctxLogger.Info("Destroying surplus VMs for user", "userLogin", userLogin, "count", len(surplusVMs))
				for _, s := range surplusVMs {
					vmToDelete := s.ID
					ctxLogger.Info("Destroying surplus VM", "vmID", vmToDelete)
					go func() { _ = a.coda.DeleteVM(context.Background(), vmToDelete, true) }()
				}
			}

			sendStreamStatusWithVmId(sender, existingVM.State, "Reconnecting to your existing VM...", existingVM.ID)
			return existingVM, existingVM.ID, nil
		}

		// Primary doesn't match — check surplus for a VM that does before destroying all
		ctxLogger.Info("Primary VM doesn't match request",
			"vmID", existingVM.ID, "existingTemplate", existingVM.Template, "existingApp", existingVM.AppName(),
			"requestedTemplate", requestedTemplate, "requestedApp", requestedApp)

		var matchingSurplus *VM
		for i := range surplusVMs {
			st := surplusVMs[i].Template == requestedTemplate
			sa := requestedApp == "" || surplusVMs[i].AppName() == requestedApp
			if st && sa {
				matchingSurplus = &surplusVMs[i]
				break
			}
		}

		if matchingSurplus != nil {
			ctxLogger.Info("Found matching VM in surplus list", "vmID", matchingSurplus.ID, "state", matchingSurplus.State)
			a.userVMsMu.Lock()
			a.userVMs[userLogin] = matchingSurplus.ID
			a.userVMsMu.Unlock()

			// Destroy the non-matching primary and other non-matching surplus in background
			primaryToDelete := existingVM.ID
			go func() { _ = a.coda.DeleteVM(context.Background(), primaryToDelete, true) }()
			for _, s := range surplusVMs {
				if s.ID != matchingSurplus.ID {
					vmToDelete := s.ID
					go func() { _ = a.coda.DeleteVM(context.Background(), vmToDelete, true) }()
				}
			}

			sendStreamStatusWithVmId(sender, matchingSurplus.State, "Reconnecting to your existing VM...", matchingSurplus.ID)
			return matchingSurplus, matchingSurplus.ID, nil
		}

		// No matching VM anywhere — queue all for deletion before creating new
		sendStreamStatusWithVmId(sender, "replacing", "Switching to a different app, replacing VM...", "")
		mismatchVMsToDelete = append(mismatchVMsToDelete, existingVM.ID)
		for _, s := range surplusVMs {
			mismatchVMsToDelete = append(mismatchVMsToDelete, s.ID)
		}
	}

	// Delete all mismatch VMs concurrently and wait for completion so that
	// CountVMsForUser (which counts non-terminal VMs) returns an accurate count.
	if len(mismatchVMsToDelete) > 0 {
		ctxLogger.Info("Waiting for mismatch VM deletions before quota check", "count", len(mismatchVMsToDelete))
		var wg sync.WaitGroup
		for _, id := range mismatchVMsToDelete {
			wg.Add(1)
			vmToDelete := id
			go func() {
				defer wg.Done()
				if delErr := a.coda.DeleteVM(context.Background(), vmToDelete, true); delErr != nil {
					ctxLogger.Warn("Failed to delete mismatch VM", "vmID", vmToDelete, "error", delErr)
				}
			}()
		}
		wg.Wait()
		ctxLogger.Info("Mismatch VM deletions completed", "count", len(mismatchVMsToDelete))
	}

	// Step 3: No usable VM -- check quota then create
	ctxLogger.Info("No existing VM found, checking quota", "userLogin", userLogin)
	count, countErr := a.coda.CountVMsForUser(ctx, userLogin)
	if countErr == nil && count >= maxUserVMs {
		errMsg := fmt.Sprintf("VM quota exceeded: you already have %d VMs (max %d), please wait for existing VMs to expire", count, maxUserVMs)
		sendStreamError(sender, errMsg)
		return nil, "", errors.New(errMsg)
	}

	ctxLogger.Info("Provisioning new VM", "userLogin", userLogin, "template", requestedTemplate)
	sendStreamStatusWithVmId(sender, "provisioning", "Provisioning new VM...", "")

	vm, createErr := a.coda.CreateVM(ctx, requestedTemplate, userLogin, vmConfig)
	if createErr != nil {
		errMsg := fmt.Sprintf("Failed to create VM: %v", createErr)
		sendStreamError(sender, errMsg)
		return nil, "", fmt.Errorf("failed to create VM: %w", createErr)
	}

	a.userVMsMu.Lock()
	a.userVMs[userLogin] = vm.ID
	a.userVMsMu.Unlock()

	ctxLogger.Info("New VM created", "userLogin", userLogin, "vmID", vm.ID, "state", vm.State, "template", requestedTemplate)
	sendStreamStatusWithVmId(sender, vm.State, "VM allocated, waiting for boot...", vm.ID)
	return vm, vm.ID, nil
}

// getVMWithRetry calls GetVM and retries once on transient (non-404) errors.
func (a *App) getVMWithRetry(ctx context.Context, vmID string) (*VM, error) {
	vm, err := a.coda.GetVM(ctx, vmID)
	if err == nil || isVMNotFoundError(err) {
		return vm, err
	}
	// Retry once for transient errors
	time.Sleep(500 * time.Millisecond)
	return a.coda.GetVM(ctx, vmID)
}

// clearUserVM removes a VM from the in-memory cache if it matches the expected ID.
func (a *App) clearUserVM(userLogin, vmID string) {
	a.userVMsMu.Lock()
	if a.userVMs[userLogin] == vmID {
		delete(a.userVMs, userLogin)
	}
	a.userVMsMu.Unlock()
}

// RunStream is called once for each active stream subscription.
// It runs for the lifetime of the stream, sending data to the client.
func (a *App) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {
	ctxLogger := a.ctxLogger(ctx)
	ctxLogger.Info("RunStream started", "path", req.Path)

	// Parse channel path: terminal/{vmId} or terminal/{vmId}/{nonce}
	parts := strings.Split(req.Path, "/")
	if len(parts) < 2 || parts[0] != "terminal" {
		errMsg := fmt.Sprintf("invalid path: %s", req.Path)
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}

	// Get VM credentials
	if a.coda == nil {
		errMsg := "coda not registered - configure enrollment key and register first"
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}

	// Extract user login for per-user VM tracking
	userLogin := getUserLogin(req)
	ctxLogger.Info("User identified for VM tracking", "userLogin", userLogin)

	// Parse optional template and app from extended path segments:
	//   terminal/{vmId}/{nonce}                       → default (vm-aws)
	//   terminal/{vmId}/{nonce}/{template}             → custom template, no app
	//   terminal/{vmId}/{nonce}/{template}/{app}       → custom template + app name
	var reqOpts vmRequestOpts
	if len(parts) >= 4 && parts[3] != "" {
		reqOpts.template = parts[3]
		if len(parts) >= 5 && parts[4] != "" {
			reqOpts.config = map[string]interface{}{
				"app": parts[4],
			}
		}
		ctxLogger.Info("Custom VM template requested", "template", reqOpts.template, "config", reqOpts.config)
	}

	// Resolve a VM: reuse existing or create new (with quota check)
	vm, vmID, err := a.resolveVMForUser(ctx, sender, userLogin, reqOpts)
	if err != nil {
		return err
	}

	// If VM is not active, poll and push status updates until it's ready
	if vm.State != "active" || vm.Credentials == nil {
		ctxLogger.Info("VM not ready, polling for status updates", "vmID", vmID, "state", vm.State)

		vm, err = a.waitForVMActive(ctx, sender, vmID)
		if err != nil {
			return err
		}

		ctxLogger.Info("VM is now active", "vmID", vmID)
	}

	// Create context that cancels when stream ends
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Output callback - sends data to frontend via Grafana Live
	onOutput := func(outputBytes []byte) {
		output := TerminalStreamOutput{
			Type: "output",
			Data: string(outputBytes),
		}
		jsonBytes, _ := json.Marshal(output)

		frame := data.NewFrame("terminal")
		frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))

		if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
			ctxLogger.Error("Failed to send frame", "error", err)
		}
	}

	// Error callback
	onError := func(err error) {
		output := TerminalStreamOutput{
			Type:  "error",
			Error: err.Error(),
		}
		jsonBytes, _ := json.Marshal(output)

		frame := data.NewFrame("terminal")
		frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
		_ = sender.SendFrame(frame, data.IncludeAll)
	}

	// SSH retry loop: retries on the SAME VM only (no replacement VMs).
	// On auth failures, re-fetches credentials from GetVM before retrying.
	// On retryable errors (timeout, connection refused), retries with a delay.
	var session *TerminalSession
	var lastErr error
	credentialRefreshCount := 0

	// Relay URL checks (invariant for the loop)
	if a.settings.CodaRelayURL == "" {
		sendStreamError(sender, "Relay URL not configured - SSH connections require the WebSocket relay")
		return errors.New("relay URL not configured")
	}
	if !IsAllowedRelayURL(a.settings.CodaRelayURL) {
		ctxLogger.Error("Relay URL not in allowlist", "relayURL", a.settings.CodaRelayURL)
		sendStreamError(sender, "Relay URL is not a trusted host")
		return errors.New("relay URL not in allowlist")
	}

	for sshRetry := 1; sshRetry <= maxSSHRetries; sshRetry++ {
		select {
		case <-ctx.Done():
			ctxLogger.Info("Connection cancelled by user", "vmID", vmID)
			return ctx.Err()
		default:
		}

		ctxLogger.Info("Creating SSH session via relay",
			"vmID", vmID,
			"host", vm.Credentials.PublicIP,
			"port", vm.Credentials.SSHPort,
			"user", vm.Credentials.SSHUser,
			"hasPrivateKey", vm.Credentials.SSHPrivateKey != "",
			"keyLength", len(vm.Credentials.SSHPrivateKey),
			"relayURL", a.settings.CodaRelayURL,
			"sshRetry", sshRetry,
		)

		accessToken, err := a.coda.GetAccessToken(ctx)
		if err != nil {
			ctxLogger.Error("Failed to get access token for relay", "error", err)
			sendStreamError(sender, fmt.Sprintf("Authentication failed: %v", err))
			return fmt.Errorf("failed to get access token: %w", err)
		}

		sshClient, err := ConnectSSHViaRelay(a.settings.CodaRelayURL, vmID, vm.Credentials, accessToken)
		if err != nil {
			lastErr = err
			ctxLogger.Warn("Relay connection failed", "vmID", vmID, "error", err, "sshRetry", sshRetry)

			if isSSHAuthError(err) && credentialRefreshCount < maxCredentialRefreshes {
				credentialRefreshCount++
				ctxLogger.Info("SSH auth failed, refreshing credentials from GetVM",
					"vmID", vmID, "refreshCount", credentialRefreshCount)
				sendStreamStatusWithVmId(sender, "retrying",
					fmt.Sprintf("Refreshing credentials (%d/%d)...", credentialRefreshCount, maxCredentialRefreshes), vmID)

				refreshedVM, refreshErr := a.coda.GetVM(ctx, vmID)
				if refreshErr == nil && refreshedVM.State == "active" && refreshedVM.Credentials != nil {
					vm = refreshedVM
					time.Sleep(sshRetryDelay)
					continue
				}
				ctxLogger.Warn("Credential refresh failed or VM not active", "vmID", vmID, "error", refreshErr)
				break
			}

			if isSSHRetryableError(err) && sshRetry < maxSSHRetries {
				ctxLogger.Info("SSH not ready, will retry", "vmID", vmID, "sshRetry", sshRetry)
				sendStreamStatusWithVmId(sender, "retrying",
					fmt.Sprintf("SSH not ready, retrying (%d/%d)...", sshRetry, maxSSHRetries), vmID)
				time.Sleep(sshRetryDelay)
				continue
			}

			break
		}

		ctxLogger.Info("Relay connection established, creating terminal session", "vmID", vmID)
		session, err = NewTerminalSessionWithClient(vmID, sshClient, onOutput, onError)
		if err != nil {
			_ = sshClient.Close()
			lastErr = err
			ctxLogger.Warn("Failed to create terminal session", "vmID", vmID, "error", err, "sshRetry", sshRetry)

			if isSSHRetryableError(err) && sshRetry < maxSSHRetries {
				sendStreamStatusWithVmId(sender, "retrying",
					fmt.Sprintf("SSH not ready, retrying (%d/%d)...", sshRetry, maxSSHRetries), vmID)
				time.Sleep(sshRetryDelay)
				continue
			}
			break
		}

		ctxLogger.Info("SSH connection successful", "vmID", vmID)
		break
	}

	if session == nil {
		errMsg := fmt.Sprintf("SSH connection failed (last error: %v). Press Connect to try again.", lastErr)
		ctxLogger.Error("All SSH retries exhausted", "vmID", vmID, "lastError", lastErr)
		sendStreamError(sender, errMsg)

		// Best-effort destroy so the broken VM doesn't consume a quota slot
		ctxLogger.Info("Destroying failed VM to free quota", "vmID", vmID, "userLogin", userLogin)
		a.clearUserVM(userLogin, vmID)
		go func() { _ = a.coda.DeleteVM(context.Background(), vmID, true) }()

		return errors.New(errMsg)
	}
	defer func() { _ = session.Close() }()

	// Store session for PublishStream to find
	a.streamSessionsMu.Lock()
	a.streamSessions[req.Path] = &streamSession{
		vmID:      vmID,
		userLogin: userLogin,
		session:   session,
		sender:    sender,
		cancel:    cancel,
	}
	a.streamSessionsMu.Unlock()

	defer func() {
		a.streamSessionsMu.Lock()
		delete(a.streamSessions, req.Path)
		a.streamSessionsMu.Unlock()
	}()

	// Send connected message to frontend with vmId so it can cache it
	connectedOutput := TerminalStreamOutput{Type: "connected", VmId: vmID}
	jsonBytes, _ := json.Marshal(connectedOutput)
	frame := data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))

	if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
		ctxLogger.Error("Failed to send connected message", "vmID", vmID, "error", err)
	} else {
		ctxLogger.Info("Sent connected message to frontend", "vmID", vmID)
	}

	ctxLogger.Info("Terminal session started", "vmID", vmID)

	// Start heartbeat sender to keep Grafana Live stream alive
	// Grafana may close idle streams, so we send heartbeats every 3 seconds
	// to ensure the stream stays active even when the user is idle
	go func() {
		// Send IMMEDIATE heartbeat to prevent early stream closure
		heartbeat := TerminalStreamOutput{Type: "heartbeat"}
		jsonBytes, _ := json.Marshal(heartbeat)
		frame := data.NewFrame("terminal")
		frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
		if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
			ctxLogger.Debug("Initial heartbeat send failed", "error", err)
			return
		}
		ctxLogger.Debug("Sent initial heartbeat")

		heartbeatTicker := time.NewTicker(3 * time.Second)
		defer heartbeatTicker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-heartbeatTicker.C:
				heartbeat := TerminalStreamOutput{Type: "heartbeat"}
				jsonBytes, _ := json.Marshal(heartbeat)
				frame := data.NewFrame("terminal")
				frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
				if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
					ctxLogger.Debug("Heartbeat send failed, stream likely closed", "error", err)
					return
				}
			}
		}
	}()

	// Poll VM state to detect expiry/destruction and disconnect gracefully
	// Capture vmID and userLogin for the goroutine
	pollVmID := vmID
	pollUserLogin := userLogin
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				polledVM, err := a.coda.GetVM(streamCtx, pollVmID)
				if err != nil {
					ctxLogger.Warn("VM state poll failed", "vmID", pollVmID, "error", err)
					continue
				}
				if polledVM.State == "destroying" || polledVM.State == "destroyed" || polledVM.State == "error" {
					ctxLogger.Info("VM no longer active, ending stream", "vmID", pollVmID, "state", polledVM.State, "userLogin", pollUserLogin)

					a.clearUserVM(pollUserLogin, pollVmID)
					ctxLogger.Info("Removed expired VM from user tracking", "userLogin", pollUserLogin, "vmID", pollVmID)

					msg := "VM lifetime expired"
					if polledVM.State == "error" {
						msg = "VM entered error state"
					}
					sendStreamError(sender, msg)
					cancel()
					return
				}
			}
		}
	}()

	// Wait for context cancellation (stream disconnect or VM expiry)
	<-streamCtx.Done()

	// Send disconnected message
	disconnectedOutput := TerminalStreamOutput{Type: "disconnected"}
	jsonBytes, _ = json.Marshal(disconnectedOutput)
	frame = data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
	_ = sender.SendFrame(frame, data.IncludeAll)

	ctxLogger.Info("RunStream ended", "vmID", vmID)
	return nil
}
