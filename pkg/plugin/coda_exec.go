package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"golang.org/x/crypto/ssh"
)

// CodaExec request/response types used by POST /coda/exec.
//
// The endpoint runs a single non-interactive shell command against the caller's
// active VM (the one currently driving their terminal stream) and returns
// stdout, stderr, exit code, and duration. It is used by challenge blocks to
// (a) run setup commands that configure the challenge environment and (b)
// verify success criteria.
//
// Auth: caller must own an active streaming session — there is no fallback to
// creating a new SSH connection here, which keeps the surface narrow and
// guarantees the exec channel is bounded to a user who has already passed
// stream subscription auth.
//
// Mode "gated" wraps the user command with a sentinel-file check so checks
// cannot pass before the challenge's setup phase has completed.

const (
	codaExecDefaultTimeoutMs = 5000
	codaExecMaxTimeoutMs     = 30000
	codaExecMaxOutputBytes   = 32 * 1024
	// codaSentinelPath lives under /tmp (not /var/run) because the SSH user
	// is typically unprivileged. The sentinel is a UI-race guard, not a
	// security boundary — the SSH user already has full shell access — so
	// world-writable /tmp is appropriate.
	codaSentinelPath = "/tmp/pathfinder-ready"
)

// CodaExecRequest is the JSON body for POST /coda/exec.
type CodaExecRequest struct {
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
	Mode      string `json:"mode,omitempty"` // "raw" (default) or "gated"
}

// CodaExecResponse is the JSON response from POST /coda/exec.
type CodaExecResponse struct {
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
	Truncated  bool   `json:"truncated,omitempty"`
}

// handleCodaExec handles POST /coda/exec.
func (a *App) handleCodaExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// User identity comes from the plugin SDK's context (populated by Grafana
	// for authenticated resource calls). Fall back to the X-Grafana-User
	// header for setups where the SDK context isn't populated. Both
	// ultimately resolve to the same Grafana login that the stream handler
	// uses to key streamSessions.
	user := userLoginFromContext(r.Context())
	if user == "" {
		user = r.Header.Get("X-Grafana-User")
	}
	if user == "" {
		a.writeError(w, "Could not identify Grafana user for this request", http.StatusUnauthorized)
		return
	}

	var req CodaExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		a.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Command == "" {
		a.writeError(w, "Command is required", http.StatusBadRequest)
		return
	}

	timeoutMs := req.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = codaExecDefaultTimeoutMs
	}
	if timeoutMs > codaExecMaxTimeoutMs {
		timeoutMs = codaExecMaxTimeoutMs
	}

	mode := req.Mode
	if mode == "" {
		mode = "raw"
	}
	if mode != "raw" && mode != "gated" {
		a.writeError(w, "Mode must be 'raw' or 'gated'", http.StatusBadRequest)
		return
	}

	client, vmID := a.findSSHClientForUser(user)
	if client == nil {
		a.writeError(w, "No active terminal session for user", http.StatusConflict)
		return
	}

	ctxLogger := a.ctxLogger(r.Context())
	ctxLogger.Info("Executing command via /coda/exec",
		"user", user, "vmID", vmID, "mode", mode, "timeoutMs", timeoutMs, "cmdLen", len(req.Command))

	execCtx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	resp, err := runRemoteCommand(execCtx, client, req.Command, mode)
	if err != nil {
		ctxLogger.Warn("/coda/exec failed", "user", user, "vmID", vmID, "error", err)
		a.writeError(w, fmt.Sprintf("Exec failed: %v", err), http.StatusBadGateway)
		return
	}

	a.writeJSON(w, resp, http.StatusOK)
}

// userLoginFromContext extracts the Grafana user login from the plugin SDK
// context. Returns "" when the context has no user (unauthenticated request
// or Grafana not forwarding identity to this plugin).
func userLoginFromContext(ctx context.Context) string {
	pluginCtx := backend.PluginConfigFromContext(ctx)
	if pluginCtx.User != nil {
		return pluginCtx.User.Login
	}
	return ""
}

// findSSHClientForUser returns the SSH client of the user's active terminal
// session, or nil if they have no active session. The vmID is returned for
// logging only. Acquires streamSessionsMu briefly.
func (a *App) findSSHClientForUser(user string) (*ssh.Client, string) {
	a.streamSessionsMu.Lock()
	defer a.streamSessionsMu.Unlock()
	for _, sess := range a.streamSessions {
		if sess == nil || sess.session == nil {
			continue
		}
		if sess.userLogin == user {
			return sess.session.SSHClient, sess.vmID
		}
	}
	return nil, ""
}

// wrapGatedCommand wraps a user command with a sentinel-file precondition.
// If the sentinel exists, the user command runs via `bash -c '<command>'`
// with the command single-quote-escaped — this prevents the command from
// breaking out of its quoting context (e.g. via an unbalanced `)`) and
// bypassing the sentinel guard.
//
// Without escape: `false ) ; echo hax #` would render as
//   `[ -f sentinel ] && ( false ) ; echo hax # )`
// which executes `echo hax` regardless of the sentinel. With the bash -c
// wrapper the malformed command stays inside the single-quoted arg and the
// gating is preserved.
func wrapGatedCommand(command string) string {
	return fmt.Sprintf("[ -f %s ] && bash -c %s", codaSentinelPath, shellSingleQuote(command))
}

// shellSingleQuote returns s wrapped in single quotes, with embedded single
// quotes encoded using the standard `'\''` pattern (close, escaped quote,
// reopen). The result is safe to use as a single argv element in a shell
// command line.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// runRemoteCommand opens a fresh non-interactive SSH session on the given
// client, runs the command (optionally wrapped for gated mode), captures
// stdout/stderr (truncated at codaExecMaxOutputBytes), and returns the result.
//
// Honors the context: on cancellation/timeout, the session is closed which
// terminates the remote command. Note: SSH does not propagate context to the
// remote process directly — we kill the channel, the remote may continue
// briefly before its stdout pipe closes, but the caller sees a clean timeout.
func runRemoteCommand(ctx context.Context, client *ssh.Client, command, mode string) (*CodaExecResponse, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer func() { _ = session.Close() }()

	effective := command
	if mode == "gated" {
		effective = wrapGatedCommand(command)
	}

	stdoutW := &limitedBuffer{buf: &bytes.Buffer{}, limit: codaExecMaxOutputBytes}
	stderrW := &limitedBuffer{buf: &bytes.Buffer{}, limit: codaExecMaxOutputBytes}
	session.Stdout = stdoutW
	session.Stderr = stderrW

	start := time.Now()
	runErrCh := make(chan error, 1)
	go func() {
		runErrCh <- session.Run(effective)
	}()

	var runErr error
	select {
	case <-ctx.Done():
		// Force the session closed so the goroutine returns. Drain runErrCh to
		// avoid leaking it.
		_ = session.Close()
		<-runErrCh
		return nil, fmt.Errorf("command timed out after %v", time.Since(start).Round(time.Millisecond))
	case runErr = <-runErrCh:
	}

	duration := time.Since(start)
	exitCode := 0
	if runErr != nil {
		var exitErr *ssh.ExitError
		if errors.As(runErr, &exitErr) {
			exitCode = exitErr.ExitStatus()
		} else if errors.Is(runErr, io.EOF) {
			// Some shells close the channel before reporting exit; treat as
			// non-zero so callers don't false-pass.
			exitCode = -1
		} else {
			return nil, fmt.Errorf("ssh run error: %w", runErr)
		}
	}

	return &CodaExecResponse{
		Stdout:     stdoutW.buf.String(),
		Stderr:     stderrW.buf.String(),
		ExitCode:   exitCode,
		DurationMs: duration.Milliseconds(),
		Truncated:  stdoutW.truncated || stderrW.truncated,
	}, nil
}

// limitedBuffer is an io.Writer that caps the bytes written to buf. Once the
// limit is reached, further writes are silently discarded (no error) so the
// remote command continues without blocking on a stalled stdout pipe.
type limitedBuffer struct {
	buf       *bytes.Buffer
	limit     int
	truncated bool
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	remaining := l.limit - l.buf.Len()
	if remaining <= 0 {
		l.truncated = true
		return len(p), nil
	}
	if len(p) <= remaining {
		return l.buf.Write(p)
	}
	if _, err := l.buf.Write(p[:remaining]); err != nil {
		return 0, err
	}
	l.truncated = true
	return len(p), nil
}
