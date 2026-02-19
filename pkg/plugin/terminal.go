package plugin

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

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

// ConnectSSH establishes an SSH connection using VM credentials.
func ConnectSSH(creds *Credentials) (*ssh.Client, error) {
	logger := log.DefaultLogger

	if creds == nil {
		return nil, fmt.Errorf("credentials are nil")
	}

	logger.Debug("SSH connection attempt",
		"host", creds.PublicIP,
		"port", creds.SSHPort,
		"user", creds.SSHUser,
		"keyLength", len(creds.SSHPrivateKey),
	)

	// Normalize the private key format
	normalizedKey := normalizePrivateKey(creds.SSHPrivateKey)

	// Debug: Log key header to verify format (safe - doesn't expose the key itself)
	keyLines := strings.Split(normalizedKey, "\n")
	if len(keyLines) > 0 {
		logger.Debug("SSH key format check",
			"firstLine", keyLines[0],
			"lineCount", len(keyLines),
		)
	}

	signer, err := ssh.ParsePrivateKey([]byte(normalizedKey))
	if err != nil {
		logger.Error("Failed to parse private key",
			"error", err,
			"keyPreview", normalizedKey[:min(50, len(normalizedKey))],
		)
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	logger.Debug("Private key parsed successfully")

	config := &ssh.ClientConfig{
		User: creds.SSHUser,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		// TODO: Implement proper host key verification for production
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second, // Increased from 10s - first connection can be slow
	}

	addr := fmt.Sprintf("%s:%d", creds.PublicIP, creds.SSHPort)
	logger.Info("Dialing SSH", "addr", addr, "user", creds.SSHUser)

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		logger.Error("SSH dial failed", "addr", addr, "error", err)
		return nil, fmt.Errorf("failed to dial SSH to %s: %w", addr, err)
	}

	logger.Info("SSH connection established", "addr", addr)
	return client, nil
}

// min returns the smaller of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// NewTerminalSession creates a new terminal session for a VM.
func NewTerminalSession(vmID string, creds *Credentials, onOutput func([]byte), onError func(error)) (*TerminalSession, error) {
	client, err := ConnectSSH(creds)
	if err != nil {
		return nil, err
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
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
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to request PTY: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	if err := session.Shell(); err != nil {
		session.Close()
		client.Close()
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
