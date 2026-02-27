package plugin

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"golang.org/x/crypto/ssh"
)

// TerminalSession manages an SSH session for a VM.
type TerminalSession struct {
	VMID       string
	SSHClient  *ssh.Client
	SSHSession *ssh.Session

	stdin  io.WriteCloser
	stdout io.Reader
	stderr io.Reader

	// Callbacks for data streaming
	onOutput func(data []byte)
	onError  func(err error)

	mu     sync.Mutex
	closed bool
}

// normalizePrivateKey ensures the private key has proper newline characters.
// Some JSON responses may have literal "\n" strings instead of actual newlines.
func normalizePrivateKey(key string) string {
	// If the key contains literal \n (backslash + n), replace with actual newlines
	if strings.Contains(key, "\\n") {
		key = strings.ReplaceAll(key, "\\n", "\n")
	}

	// Ensure proper line endings (no \r\n)
	key = strings.ReplaceAll(key, "\r\n", "\n")

	// Trim any extra whitespace
	key = strings.TrimSpace(key)

	// Ensure key ends with a newline (required by some SSH parsers)
	if !strings.HasSuffix(key, "\n") {
		key = key + "\n"
	}

	return key
}

// ConnectSSHViaRelay establishes an SSH connection through a WebSocket relay.
// This is used when direct TCP access to the VM is not available (e.g., Grafana Cloud).
func ConnectSSHViaRelay(relayURL string, vmID string, creds *Credentials, token string) (*ssh.Client, error) {
	logger := log.DefaultLogger

	if creds == nil {
		return nil, fmt.Errorf("credentials are nil")
	}

	wsURL := fmt.Sprintf("%s/relay/%s", relayURL, vmID)
	logger.Info("Attempting WebSocket relay connection",
		"relayURL", wsURL,
		"vmID", vmID,
		"user", creds.SSHUser,
		"hasToken", token != "",
	)

	startTime := time.Now()

	dialer := websocket.Dialer{
		HandshakeTimeout: 30 * time.Second,
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+token)

	wsConn, resp, err := dialer.Dial(wsURL, header)
	dialDuration := time.Since(startTime)

	if err != nil {
		errorCategory := categorizeConnectionError(err, resp)
		logFields := []interface{}{
			"url", wsURL,
			"vmID", vmID,
			"error", err.Error(),
			"errorCategory", errorCategory,
			"dialDurationMs", dialDuration.Milliseconds(),
		}

		if resp != nil {
			logFields = append(logFields,
				"statusCode", resp.StatusCode,
				"status", resp.Status,
			)
			if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
				logger.Error("WebSocket relay connection BLOCKED - authentication/authorization failure", logFields...)
			} else if resp.StatusCode >= 500 {
				logger.Error("WebSocket relay connection FAILED - server error", logFields...)
			} else {
				logger.Error("WebSocket relay connection FAILED - HTTP error", logFields...)
			}
		} else {
			logger.Error("WebSocket relay connection FAILED - network/connection error", logFields...)
		}

		return nil, fmt.Errorf("failed to connect to relay (%s): %w", errorCategory, err)
	}

	logger.Info("WebSocket relay connection SUCCESSFUL",
		"url", wsURL,
		"vmID", vmID,
		"dialDurationMs", dialDuration.Milliseconds(),
	)

	conn := NewWSConn(wsConn)

	normalizedKey := normalizePrivateKey(creds.SSHPrivateKey)
	signer, err := ssh.ParsePrivateKey([]byte(normalizedKey))
	if err != nil {
		_ = conn.Close()
		logger.Error("SSH key parsing failed after relay connection",
			"vmID", vmID,
			"error", err,
		)
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	logger.Debug("SSH key parsed successfully, initiating SSH handshake via relay",
		"vmID", vmID,
		"user", creds.SSHUser,
	)

	config := &ssh.ClientConfig{
		User: creds.SSHUser,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", creds.PublicIP, creds.SSHPort)
	sshStartTime := time.Now()

	c, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	sshDuration := time.Since(sshStartTime)

	if err != nil {
		_ = conn.Close()
		logger.Error("SSH handshake via relay FAILED",
			"vmID", vmID,
			"addr", addr,
			"error", err.Error(),
			"sshHandshakeDurationMs", sshDuration.Milliseconds(),
			"totalDurationMs", time.Since(startTime).Milliseconds(),
		)
		return nil, fmt.Errorf("SSH handshake via relay failed: %w", err)
	}

	client := ssh.NewClient(c, chans, reqs)
	totalDuration := time.Since(startTime)

	logger.Info("SSH connection via relay SUCCESSFUL",
		"vmID", vmID,
		"addr", addr,
		"user", creds.SSHUser,
		"wsDialDurationMs", dialDuration.Milliseconds(),
		"sshHandshakeDurationMs", sshDuration.Milliseconds(),
		"totalDurationMs", totalDuration.Milliseconds(),
	)

	return client, nil
}

// categorizeConnectionError returns a human-readable category for connection errors
func categorizeConnectionError(err error, resp *http.Response) string {
	if resp != nil {
		switch resp.StatusCode {
		case http.StatusForbidden:
			return "blocked_forbidden"
		case http.StatusUnauthorized:
			return "blocked_unauthorized"
		case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
			return "relay_unavailable"
		default:
			if resp.StatusCode >= 500 {
				return "server_error"
			}
			return fmt.Sprintf("http_error_%d", resp.StatusCode)
		}
	}

	errStr := strings.ToLower(err.Error())
	switch {
	case strings.Contains(errStr, "connection refused"):
		return "connection_refused"
	case strings.Contains(errStr, "timeout") || strings.Contains(errStr, "deadline exceeded"):
		return "timeout"
	case strings.Contains(errStr, "no such host") || strings.Contains(errStr, "dns"):
		return "dns_error"
	case strings.Contains(errStr, "connection reset"):
		return "connection_reset"
	case strings.Contains(errStr, "tls") || strings.Contains(errStr, "certificate"):
		return "tls_error"
	case strings.Contains(errStr, "network is unreachable"):
		return "network_unreachable"
	case strings.Contains(errStr, "eof"):
		return "connection_closed"
	default:
		return "unknown"
	}
}

// NewTerminalSessionWithClient creates a terminal session using an existing SSH client.
func NewTerminalSessionWithClient(vmID string, client *ssh.Client, onOutput func([]byte), onError func(error)) (*TerminalSession, error) {
	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	// Request PTY for interactive terminal
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,     // Enable echo
		ssh.TTY_OP_ISPEED: 14400, // Input speed
		ssh.TTY_OP_OSPEED: 14400, // Output speed
	}

	// Default terminal size, will be resized by client
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to request PTY: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	if err := session.Shell(); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to start shell: %w", err)
	}

	ts := &TerminalSession{
		VMID:       vmID,
		SSHClient:  client,
		SSHSession: session,
		stdin:      stdin,
		stdout:     stdout,
		stderr:     stderr,
		onOutput:   onOutput,
		onError:    onError,
	}

	// Start output forwarding goroutines
	go ts.forwardOutput()
	go ts.forwardStderr()

	return ts, nil
}

// forwardOutput reads from SSH stdout and calls the output callback.
func (ts *TerminalSession) forwardOutput() {
	buf := make([]byte, 4096)
	for {
		n, err := ts.stdout.Read(buf)
		if err != nil {
			if err != io.EOF && !ts.isClosed() {
				if ts.onError != nil {
					ts.onError(fmt.Errorf("stdout read error: %w", err))
				}
			}
			return
		}
		if n > 0 && ts.onOutput != nil {
			// Make a copy to avoid data race
			data := make([]byte, n)
			copy(data, buf[:n])
			ts.onOutput(data)
		}
	}
}

// forwardStderr reads from SSH stderr and calls the output callback.
func (ts *TerminalSession) forwardStderr() {
	buf := make([]byte, 4096)
	for {
		n, err := ts.stderr.Read(buf)
		if err != nil {
			if err != io.EOF && !ts.isClosed() {
				log.DefaultLogger.Warn("stderr read error", "error", err, "vmID", ts.VMID)
			}
			return
		}
		if n > 0 && ts.onOutput != nil {
			// Send stderr to same output (terminal combines them)
			data := make([]byte, n)
			copy(data, buf[:n])
			ts.onOutput(data)
		}
	}
}

// Write sends data to the SSH session's stdin.
func (ts *TerminalSession) Write(data []byte) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return fmt.Errorf("session is closed")
	}

	_, err := ts.stdin.Write(data)
	return err
}

// Resize changes the terminal window size.
func (ts *TerminalSession) Resize(rows, cols int) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return fmt.Errorf("session is closed")
	}

	return ts.SSHSession.WindowChange(rows, cols)
}

// Close terminates the SSH session and connection.
func (ts *TerminalSession) Close() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return nil
	}
	ts.closed = true

	var errs []error

	if ts.stdin != nil {
		if err := ts.stdin.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if ts.SSHSession != nil {
		if err := ts.SSHSession.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if ts.SSHClient != nil {
		if err := ts.SSHClient.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing session: %v", errs)
	}

	return nil
}

// isClosed returns true if the session has been closed.
func (ts *TerminalSession) isClosed() bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return ts.closed
}
