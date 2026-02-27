// Package plugin implements the Grafana Pathfinder app plugin backend.
//
// Terminal Streaming Architecture (Hybrid: Grafana Live + HTTP):
//
//	┌─────────────┐                      ┌─────────────┐
//	│   Frontend  │                      │   Backend   │
//	│  (xterm.js) │                      │  (Go/SSH)   │
//	└──────┬──────┘                      └──────┬──────┘
//	       │                                    │
//	       │  ── HTTP POST /terminal/{id} ───► │  (keyboard input, resize)
//	       │                                    │
//	       │  ◄──── Grafana Live RunStream ────│  (SSH output, status)
//	       │                                    │
//
// Architecture Notes:
// - Output: Grafana Live streaming via RunStream (real-time SSH output)
// - Input: HTTP POST to /api/plugins/.../resources/terminal/{vmId}
//
// Why not use PublishStream for input?
// Grafana's /api/live/publish HTTP endpoint restricts frontend publishing
// to plugin channels (returns 403 Forbidden). While the SDK's PublishStream
// handler is implemented, the HTTP publish path is blocked by Grafana's
// security layer. We use a dedicated HTTP resource endpoint instead.
//
// Handler Responsibilities:
// - SubscribeStream: Authorizes subscription, validates VM exists
// - PublishStream: Implemented but not used (frontend can't publish via Live)
// - RunStream: Establishes SSH connection, streams output to frontend
// - handleTerminalInput (resources.go): Receives terminal input via HTTP POST
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
	vmID    string
	session *TerminalSession
	sender  *backend.StreamSender
	cancel  context.CancelFunc
}

// streamSessions holds active streaming sessions (path -> session)
var (
	streamSessions   = make(map[string]*streamSession)
	streamSessionsMu sync.Mutex
)

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
	a.logger.Info("SubscribeStream called", "path", req.Path)

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
		a.logger.Error("Coda not registered for stream subscription")
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	// Allow "new" vmId - RunStream will provision a fresh VM
	if vmID == "new" || vmID == "" {
		a.logger.Info("Stream subscription accepted for new VM provisioning")
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	// For existing vmId, verify VM exists (allow pending/provisioning VMs - RunStream will wait)
	// If VM doesn't exist or is invalid, RunStream will handle provisioning a replacement
	vm, err := a.coda.GetVM(ctx, vmID)
	if err != nil {
		// VM not found - still accept, RunStream will provision a new one
		a.logger.Info("VM not found, will provision in RunStream", "vmID", vmID)
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	// Only reject destroyed or error states at subscription time for better UX
	// (avoids immediate subscription failure for expired VMs - RunStream handles replacement)
	if vm.State == "destroyed" || vm.State == "destroying" || vm.State == "error" {
		a.logger.Info("VM in terminal state, will provision replacement in RunStream", "vmID", vmID, "state", vm.State)
		// Still accept - RunStream will handle provisioning a replacement
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusOK,
		}, nil
	}

	a.logger.Info("Stream subscription accepted", "vmID", vmID, "state", vm.State)

	return &backend.SubscribeStreamResponse{
		Status: backend.SubscribeStreamStatusOK,
	}, nil
}

// PublishStream is called when a client publishes a message to a stream.
// This handles terminal input from the frontend (keyboard input, resize events).
// This is the primary input path for bidirectional terminal communication.
func (a *App) PublishStream(ctx context.Context, req *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	a.logger.Debug("PublishStream called", "path", req.Path, "dataLen", len(req.Data))

	// Parse channel path: terminal/{vmId} or terminal/{vmId}/{nonce}
	parts := strings.Split(req.Path, "/")
	if len(parts) < 2 || parts[0] != "terminal" {
		a.logger.Warn("PublishStream: invalid path", "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	vmID := parts[1]

	// Get the active session
	streamSessionsMu.Lock()
	sess, exists := streamSessions[req.Path]
	streamSessionsMu.Unlock()

	if !exists || sess == nil || sess.session == nil {
		a.logger.Warn("PublishStream: no active session", "vmID", vmID, "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	// Parse the input message
	var input TerminalInput
	if err := json.Unmarshal(req.Data, &input); err != nil {
		a.logger.Error("PublishStream: failed to parse input", "error", err, "data", string(req.Data))
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusPermissionDenied,
		}, nil
	}

	// Handle the message
	switch input.Type {
	case "input":
		if err := sess.session.Write([]byte(input.Data)); err != nil {
			a.logger.Error("PublishStream: failed to write to SSH", "vmID", vmID, "error", err)
		} else {
			a.logger.Debug("PublishStream: wrote input to SSH", "vmID", vmID, "dataLen", len(input.Data))
		}
	case "resize":
		if input.Rows > 0 && input.Cols > 0 {
			if err := sess.session.Resize(input.Rows, input.Cols); err != nil {
				a.logger.Error("PublishStream: failed to resize terminal", "vmID", vmID, "error", err)
			} else {
				a.logger.Debug("PublishStream: resized terminal", "vmID", vmID, "rows", input.Rows, "cols", input.Cols)
			}
		}
	default:
		a.logger.Warn("PublishStream: unknown input type", "type", input.Type)
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

// isSSHRetryableError checks if an error is retryable (timeouts, connection issues, auth failures)
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
		strings.Contains(errStr, "broken pipe") ||
		isSSHAuthError(err)
}

// SSH retry constants
const (
	maxVMAttempts      = 3                    // Maximum new VMs to provision per connection attempt
	maxSSHRetriesPerVM = 3                    // SSH connection retries per VM
	sshRetryDelay      = 5 * time.Second      // Delay between same-VM retries
)

// waitForVMActive polls until VM is active and returns it, sending status updates
func (a *App) waitForVMActive(ctx context.Context, sender *backend.StreamSender, vmID string) (*VM, error) {
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
				a.logger.Warn("Failed to poll VM status", "vmID", vmID, "error", err)
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

// RunStream is called once for each active stream subscription.
// It runs for the lifetime of the stream, sending data to the client.
func (a *App) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {
	a.logger.Info("RunStream started", "path", req.Path)

	// Parse channel path: terminal/{vmId} or terminal/{vmId}/{nonce}
	parts := strings.Split(req.Path, "/")
	if len(parts) < 2 || parts[0] != "terminal" {
		errMsg := fmt.Sprintf("invalid path: %s", req.Path)
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}

	vmID := parts[1]

	// Get VM credentials
	if a.coda == nil {
		errMsg := "coda not registered - configure enrollment key and register first"
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}

	var vm *VM
	var err error

	// Handle "new" vmId - provision a fresh VM
	if vmID == "new" || vmID == "" {
		a.logger.Info("Provisioning new VM (no vmId provided)")
		sendStreamStatusWithVmId(sender, "provisioning", "Provisioning new VM...", "")

		vm, err = a.coda.CreateVM(ctx, "vm-aws", "stream-session")
		if err != nil {
			errMsg := fmt.Sprintf("failed to create VM: %v", err)
			sendStreamError(sender, errMsg)
			return fmt.Errorf("failed to create VM: %w", err)
		}
		vmID = vm.ID
		a.logger.Info("New VM created", "vmID", vmID, "state", vm.State)
		sendStreamStatusWithVmId(sender, vm.State, "VM allocated, waiting for boot...", vmID)
	} else {
		// Try to get existing VM
		vm, err = a.coda.GetVM(ctx, vmID)
		if err != nil {
			// VM doesn't exist - provision a new one
			a.logger.Info("VM not found, provisioning new one", "requestedVmID", vmID, "error", err)
			sendStreamStatusWithVmId(sender, "provisioning", "Previous VM not found, provisioning new one...", "")

			vm, err = a.coda.CreateVM(ctx, "vm-aws", "stream-session")
			if err != nil {
				errMsg := fmt.Sprintf("failed to create VM: %v", err)
				sendStreamError(sender, errMsg)
				return fmt.Errorf("failed to create VM: %w", err)
			}
			vmID = vm.ID
			a.logger.Info("New VM created (replacing missing)", "vmID", vmID, "state", vm.State)
			sendStreamStatusWithVmId(sender, vm.State, "VM allocated, waiting for boot...", vmID)
		} else if vm.State == "destroyed" || vm.State == "destroying" || vm.State == "error" {
			// VM is in terminal state - provision a new one
			a.logger.Info("VM in terminal state, provisioning new one", "vmID", vmID, "state", vm.State)
			sendStreamStatusWithVmId(sender, "provisioning", fmt.Sprintf("Previous VM %s, provisioning new one...", vm.State), "")

			vm, err = a.coda.CreateVM(ctx, "vm-aws", "stream-session")
			if err != nil {
				errMsg := fmt.Sprintf("failed to create VM: %v", err)
				sendStreamError(sender, errMsg)
				return fmt.Errorf("failed to create VM: %w", err)
			}
			vmID = vm.ID
			a.logger.Info("New VM created (replacing expired)", "vmID", vmID, "state", vm.State)
			sendStreamStatusWithVmId(sender, vm.State, "VM allocated, waiting for boot...", vmID)
		} else {
			// VM exists and is valid - send status with vmId
			a.logger.Info("Reconnecting to existing VM", "vmID", vmID, "state", vm.State)
			sendStreamStatusWithVmId(sender, vm.State, "Reconnecting to existing VM...", vmID)
		}
	}

	// If VM is not active, poll and push status updates until it's ready
	if vm.State != "active" || vm.Credentials == nil {
		a.logger.Info("VM not ready, polling for status updates", "vmID", vmID, "state", vm.State)

		vm, err = a.waitForVMActive(ctx, sender, vmID)
		if err != nil {
			return err
		}

		a.logger.Info("VM is now active", "vmID", vmID)
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
			a.logger.Error("Failed to send frame", "error", err)
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

	// Two-level SSH retry logic:
	// - Outer loop: VM attempts (max 3 VMs to prevent resource waste)
	// - Inner loop: SSH retries per VM (max 3 retries with delay for slow SSH startup)
	var session *TerminalSession
	var lastErr error

	for vmAttempt := 1; vmAttempt <= maxVMAttempts; vmAttempt++ {
		a.logger.Info("Starting SSH connection attempts for VM",
			"vmID", vmID,
			"vmAttempt", vmAttempt,
			"maxVMAttempts", maxVMAttempts,
		)

		// Inner loop: retry same VM multiple times (handles slow SSH daemon startup)
		for sshRetry := 1; sshRetry <= maxSSHRetriesPerVM; sshRetry++ {
			// Check context cancellation
			select {
			case <-ctx.Done():
				a.logger.Info("Connection cancelled by user", "vmID", vmID)
				return ctx.Err()
			default:
			}

			// Relay URL is mandatory - fail if not configured
			if a.settings.CodaRelayURL == "" {
				sendStreamError(sender, "Relay URL not configured - SSH connections require the WebSocket relay")
				return errors.New("relay URL not configured")
			}

			// Log credentials info (without sensitive data)
			a.logger.Info("Creating SSH session via relay",
				"vmID", vmID,
				"host", vm.Credentials.PublicIP,
				"port", vm.Credentials.SSHPort,
				"user", vm.Credentials.SSHUser,
				"hasPrivateKey", vm.Credentials.SSHPrivateKey != "",
				"keyLength", len(vm.Credentials.SSHPrivateKey),
				"relayURL", a.settings.CodaRelayURL,
				"vmAttempt", vmAttempt,
				"sshRetry", sshRetry,
			)

			// Get a fresh access token for the relay connection
			if a.coda == nil {
				errMsg := "Coda client not initialized - cannot connect to relay"
				sendStreamError(sender, errMsg)
				return fmt.Errorf("coda client not initialized")
			}
			accessToken, err := a.coda.GetAccessToken(ctx)
			if err != nil {
				a.logger.Error("Failed to get access token for relay", "error", err)
				sendStreamError(sender, fmt.Sprintf("Authentication failed: %v", err))
				return fmt.Errorf("failed to get access token: %w", err)
			}

			sshClient, err := ConnectSSHViaRelay(a.settings.CodaRelayURL, vmID, vm.Credentials, accessToken)
			if err != nil {
				lastErr = err
				a.logger.Warn("Relay connection failed",
					"vmID", vmID,
					"error", err,
					"vmAttempt", vmAttempt,
					"sshRetry", sshRetry,
				)

				// Check if error is retryable and we have same-VM retries left
				if isSSHRetryableError(err) && sshRetry < maxSSHRetriesPerVM {
					a.logger.Info("SSH not ready, will retry same VM", "vmID", vmID, "sshRetry", sshRetry)
					sendStreamStatusWithVmId(sender, "retrying", fmt.Sprintf("SSH not ready, retrying (%d/%d)...", sshRetry, maxSSHRetriesPerVM), vmID)
					time.Sleep(sshRetryDelay)
					continue
				}

				// All same-VM retries exhausted, break to try new VM
				break
			}

			a.logger.Info("Relay connection established, creating terminal session", "vmID", vmID)
			session, err = NewTerminalSessionWithClient(vmID, sshClient, onOutput, onError)
			if err != nil {
				_ = sshClient.Close()
				lastErr = err
				a.logger.Warn("Failed to create terminal session with relay client",
					"vmID", vmID,
					"error", err,
					"vmAttempt", vmAttempt,
					"sshRetry", sshRetry,
				)

				// Check if error is retryable and we have same-VM retries left
				if isSSHRetryableError(err) && sshRetry < maxSSHRetriesPerVM {
					a.logger.Info("Session creation failed, will retry same VM", "vmID", vmID, "sshRetry", sshRetry)
					sendStreamStatusWithVmId(sender, "retrying", fmt.Sprintf("SSH not ready, retrying (%d/%d)...", sshRetry, maxSSHRetriesPerVM), vmID)
					time.Sleep(sshRetryDelay)
					continue
				}

				// All same-VM retries exhausted, break to try new VM
				break
			}
			// Success!
			break
		}

		// If we got a session, we're done
		if session != nil {
			a.logger.Info("SSH connection successful", "vmID", vmID, "vmAttempt", vmAttempt)
			break
		}

		// All same-VM retries failed - provision new VM if under limit
		if vmAttempt < maxVMAttempts {
			a.logger.Info("All SSH retries failed for VM, provisioning new one",
				"failedVmID", vmID,
				"vmAttempt", vmAttempt,
				"lastError", lastErr,
			)
			sendStreamStatusWithVmId(sender, "provisioning", fmt.Sprintf("VM %d failed, provisioning VM %d/%d...", vmAttempt, vmAttempt+1, maxVMAttempts), vmID)

			// Provision a fresh VM
			newVM, createErr := a.coda.CreateVM(ctx, "vm-aws", "stream-session")
			if createErr != nil {
				a.logger.Error("Failed to provision fresh VM for retry", "error", createErr)
				sendStreamError(sender, fmt.Sprintf("Failed to provision replacement VM: %v", createErr))
				return fmt.Errorf("failed to provision replacement VM: %w", createErr)
			}
			vmID = newVM.ID
			a.logger.Info("Fresh VM provisioned for retry", "newVmID", vmID, "state", newVM.State, "vmAttempt", vmAttempt+1)
			sendStreamStatusWithVmId(sender, newVM.State, fmt.Sprintf("VM %d allocated, waiting for boot...", vmAttempt+1), vmID)

			// Wait for new VM to be active
			vm, err = a.waitForVMActive(ctx, sender, vmID)
			if err != nil {
				return err
			}
		}
	}

	if session == nil {
		errMsg := fmt.Sprintf("SSH connection failed after %d VMs (last error: %v)", maxVMAttempts, lastErr)
		a.logger.Error("All VM attempts exhausted", "lastError", lastErr)
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}
	defer func() { _ = session.Close() }()

	// Store session for PublishStream to use
	streamSessionsMu.Lock()
	streamSessions[req.Path] = &streamSession{
		vmID:    vmID,
		session: session,
		sender:  sender,
		cancel:  cancel,
	}
	streamSessionsMu.Unlock()

	defer func() {
		streamSessionsMu.Lock()
		delete(streamSessions, req.Path)
		streamSessionsMu.Unlock()
	}()

	// Send connected message to frontend with vmId so it can cache it
	connectedOutput := TerminalStreamOutput{Type: "connected", VmId: vmID}
	jsonBytes, _ := json.Marshal(connectedOutput)
	frame := data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))

	if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
		a.logger.Error("Failed to send connected message", "vmID", vmID, "error", err)
	} else {
		a.logger.Info("Sent connected message to frontend", "vmID", vmID)
	}

	a.logger.Info("Terminal session started", "vmID", vmID)

	// Poll VM state to detect expiry/destruction and disconnect gracefully
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				polledVM, err := a.coda.GetVM(streamCtx, vmID)
				if err != nil {
					a.logger.Warn("VM state poll failed", "vmID", vmID, "error", err)
					continue
				}
				if polledVM.State == "destroying" || polledVM.State == "destroyed" || polledVM.State == "error" {
					a.logger.Info("VM no longer active, ending stream", "vmID", vmID, "state", polledVM.State)
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

	a.logger.Info("RunStream ended", "vmID", vmID)
	return nil
}
