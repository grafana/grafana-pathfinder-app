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

// streamSessions holds active streaming sessions keyed by vmID.
var (
	streamSessions   = make(map[string]*streamSession)
	streamSessionsMu sync.Mutex
)

// parseTerminalPath extracts the vmID from a stream channel path.
// Accepts "terminal/{vmId}" or "terminal/{vmId}/{nonce}".
func parseTerminalPath(path string) (vmID string, ok bool) {
	parts := strings.Split(path, "/")
	if len(parts) < 2 || len(parts) > 3 || parts[0] != "terminal" {
		return "", false
	}
	if parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

// TerminalStreamInput represents input messages from the frontend
type TerminalStreamInput struct {
	Type string `json:"type"` // "input", "resize"
	Data string `json:"data,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Cols int    `json:"cols,omitempty"`
}

// TerminalStreamOutput represents output messages to the frontend
type TerminalStreamOutput struct {
	Type  string `json:"type"` // "output", "error", "connected", "disconnected"
	Data  string `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// SubscribeStream is called when a client wants to subscribe to a stream.
// Channel path format: terminal/{vmId} or terminal/{vmId}/{nonce}
func (a *App) SubscribeStream(ctx context.Context, req *backend.SubscribeStreamRequest) (*backend.SubscribeStreamResponse, error) {
	a.logger.Info("SubscribeStream called", "path", req.Path)

	vmID, ok := parseTerminalPath(req.Path)
	if !ok {
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	// Check if Coda is configured (has JWT token)
	if a.coda == nil {
		a.logger.Error("coda not registered for stream subscription")
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	// Verify VM exists and is active
	vm, err := a.coda.GetVM(ctx, vmID)
	if err != nil {
		a.logger.Error("Failed to get VM for subscription", "vmID", vmID, "error", err)
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	if vm.State != "active" || vm.Credentials == nil {
		a.logger.Warn("VM not ready for terminal", "vmID", vmID, "state", vm.State)
		return &backend.SubscribeStreamResponse{
			Status: backend.SubscribeStreamStatusNotFound,
		}, nil
	}

	a.logger.Info("Stream subscription accepted", "vmID", vmID)

	return &backend.SubscribeStreamResponse{
		Status: backend.SubscribeStreamStatusOK,
	}, nil
}

// PublishStream is called when a client publishes a message to a stream.
// This handles terminal input from the frontend (keyboard input, resize events).
// This is the primary input path for bidirectional terminal communication.
func (a *App) PublishStream(ctx context.Context, req *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	a.logger.Debug("PublishStream called", "path", req.Path, "dataLen", len(req.Data))

	vmID, ok := parseTerminalPath(req.Path)
	if !ok {
		a.logger.Warn("PublishStream: invalid path", "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	streamSessionsMu.Lock()
	sess, exists := streamSessions[vmID]
	streamSessionsMu.Unlock()

	if !exists || sess == nil || sess.session == nil {
		a.logger.Warn("PublishStream: no active session", "vmID", vmID, "path", req.Path)
		return &backend.PublishStreamResponse{
			Status: backend.PublishStreamStatusNotFound,
		}, nil
	}

	// Parse the input message
	var input TerminalStreamInput
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

// RunStream is called once for each active stream subscription.
// It runs for the lifetime of the stream, sending data to the client.
func (a *App) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {
	a.logger.Info("RunStream started", "path", req.Path)

	vmID, ok := parseTerminalPath(req.Path)
	if !ok {
		errMsg := fmt.Sprintf("invalid path: %s", req.Path)
		sendStreamError(sender, errMsg)
		return fmt.Errorf("invalid path: %s", req.Path)
	}

	if a.coda == nil {
		errMsg := "coda not registered - configure enrollment key and register first"
		sendStreamError(sender, errMsg)
		return errors.New(errMsg)
	}

	vm, err := a.coda.GetVM(ctx, vmID)
	if err != nil {
		errMsg := fmt.Sprintf("failed to get VM: %v", err)
		sendStreamError(sender, errMsg)
		return fmt.Errorf("failed to get VM: %w", err)
	}

	if vm.State != "active" || vm.Credentials == nil {
		errMsg := fmt.Sprintf("VM not ready: state=%s", vm.State)
		sendStreamError(sender, errMsg)
		return fmt.Errorf("VM not ready: state=%s", vm.State)
	}

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

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

	a.logger.Info("Creating SSH session",
		"vmID", vmID,
		"host", vm.Credentials.PublicIP,
		"port", vm.Credentials.SSHPort,
		"user", vm.Credentials.SSHUser,
		"hasPrivateKey", vm.Credentials.SSHPrivateKey != "",
		"keyLength", len(vm.Credentials.SSHPrivateKey),
	)

	session, err := NewTerminalSession(vmID, vm.Credentials, onOutput, onError)
	if err != nil {
		a.logger.Error("Failed to create terminal session",
			"vmID", vmID,
			"error", err,
			"host", vm.Credentials.PublicIP,
			"port", vm.Credentials.SSHPort,
		)
		errMsg := fmt.Sprintf("SSH connection failed: %v", err)
		sendStreamError(sender, errMsg)
		return fmt.Errorf("failed to create terminal session: %w", err)
	}
	defer func() { _ = session.Close() }()

	// Close any previous session for this VM (e.g. stale reconnect) before
	// registering the new one, so we don't leak SSH connections.
	streamSessionsMu.Lock()
	if prev, exists := streamSessions[vmID]; exists && prev.cancel != nil {
		prev.cancel()
	}
	thisSession := &streamSession{
		vmID:    vmID,
		session: session,
		sender:  sender,
		cancel:  cancel,
	}
	streamSessions[vmID] = thisSession
	streamSessionsMu.Unlock()

	defer func() {
		streamSessionsMu.Lock()
		if cur, exists := streamSessions[vmID]; exists && cur == thisSession {
			delete(streamSessions, vmID)
		}
		streamSessionsMu.Unlock()
	}()

	connectedOutput := TerminalStreamOutput{Type: "connected"}
	jsonBytes, _ := json.Marshal(connectedOutput)
	frame := data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))

	if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
		a.logger.Error("Failed to send connected message", "vmID", vmID, "error", err)
	} else {
		a.logger.Info("Sent connected message to frontend", "vmID", vmID)
	}

	a.logger.Info("Terminal session started", "vmID", vmID)

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

	<-streamCtx.Done()

	disconnectedOutput := TerminalStreamOutput{Type: "disconnected"}
	jsonBytes, _ = json.Marshal(disconnectedOutput)
	frame = data.NewFrame("terminal")
	frame.Fields = append(frame.Fields, data.NewField("data", nil, []string{string(jsonBytes)}))
	_ = sender.SendFrame(frame, data.IncludeAll)

	a.logger.Info("RunStream ended", "vmID", vmID)
	return nil
}
