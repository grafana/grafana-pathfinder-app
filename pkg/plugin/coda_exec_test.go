package plugin

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"golang.org/x/crypto/ssh"
)

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

func TestWrapGatedCommand(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "simple command",
			in:   "echo hi",
			want: "[ -f " + codaSentinelPath + " ] && bash -c 'echo hi'",
		},
		{
			name: "command with single quotes is escaped",
			in:   `grep -q '^foo$' /tmp/f`,
			want: `[ -f ` + codaSentinelPath + ` ] && bash -c 'grep -q '\''^foo$'\'' /tmp/f'`,
		},
		{
			name: "breakout attempt stays quoted (regression: no shell-injection)",
			in:   `false ) ; echo hax #`,
			want: `[ -f ` + codaSentinelPath + ` ] && bash -c 'false ) ; echo hax #'`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := wrapGatedCommand(tc.in)
			if got != tc.want {
				t.Errorf("wrapGatedCommand mismatch\ngot:  %q\nwant: %q", got, tc.want)
			}
		})
	}
}

func TestShellSingleQuote(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", "''"},
		{"abc", "'abc'"},
		{`a'b`, `'a'\''b'`},
		{`a'b'c`, `'a'\''b'\''c'`},
	}
	for _, tc := range cases {
		got := shellSingleQuote(tc.in)
		if got != tc.want {
			t.Errorf("shellSingleQuote(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestLimitedBuffer(t *testing.T) {
	var underlying bytes.Buffer
	lb := &limitedBuffer{buf: &underlying, limit: 5}

	n, err := lb.Write([]byte("abc"))
	if err != nil || n != 3 {
		t.Fatalf("first write: n=%d err=%v", n, err)
	}
	if underlying.String() != "abc" {
		t.Errorf("after first write: got %q", underlying.String())
	}
	if lb.truncated {
		t.Error("truncated flag set too early")
	}

	// Second write exceeds the limit; reports the full input length to avoid
	// blocking the producer, but only writes 2 more bytes.
	n, err = lb.Write([]byte("defgh"))
	if err != nil {
		t.Fatalf("second write error: %v", err)
	}
	if n != 5 {
		t.Errorf("second write n=%d, want 5", n)
	}
	if underlying.String() != "abcde" {
		t.Errorf("after second write: got %q, want %q", underlying.String(), "abcde")
	}
	if !lb.truncated {
		t.Error("truncated flag should be set after over-limit write")
	}

	// Third write hits the cap entirely; underlying is unchanged.
	n, err = lb.Write([]byte("ijkl"))
	if err != nil || n != 4 {
		t.Fatalf("third write: n=%d err=%v", n, err)
	}
	if underlying.String() != "abcde" {
		t.Errorf("after third write: got %q, want %q", underlying.String(), "abcde")
	}
}

// ---------------------------------------------------------------------------
// HTTP handler — validation paths
// ---------------------------------------------------------------------------

func newExecApp() *App {
	return &App{
		logger:         log.DefaultLogger,
		streamSessions: map[string]*streamSession{},
	}
}

func postExec(t *testing.T, app *App, body, user string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/coda/exec", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		// Inject the user identity via the SDK's plugin context (the only
		// channel the handler accepts, after the X-Grafana-User fallback was
		// removed). Mirrors what httpadapter does for real requests.
		pluginCtx := backend.PluginContext{
			User: &backend.User{Login: user, Name: user},
		}
		req = req.WithContext(backend.WithPluginContext(req.Context(), pluginCtx))
	}
	rr := httptest.NewRecorder()
	app.handleCodaExec(rr, req)
	return rr
}

func TestHandleCodaExec_MethodNotAllowed(t *testing.T) {
	app := newExecApp()
	req := httptest.NewRequest(http.MethodGet, "/coda/exec", nil)
	rr := httptest.NewRecorder()
	app.handleCodaExec(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleCodaExec_MissingUser(t *testing.T) {
	app := newExecApp()
	rr := postExec(t, app, `{"command":"true"}`, "")
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleCodaExec_InvalidBody(t *testing.T) {
	app := newExecApp()
	rr := postExec(t, app, `not json`, "alice")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCodaExec_MissingCommand(t *testing.T) {
	app := newExecApp()
	rr := postExec(t, app, `{}`, "alice")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCodaExec_InvalidMode(t *testing.T) {
	app := newExecApp()
	rr := postExec(t, app, `{"command":"true","mode":"nope"}`, "alice")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCodaExec_NoActiveSession(t *testing.T) {
	app := newExecApp()
	rr := postExec(t, app, `{"command":"true"}`, "alice")
	if rr.Code != http.StatusConflict {
		t.Errorf("got %d, want %d", rr.Code, http.StatusConflict)
	}
}

// TestHandleCodaExec_HeaderUserIsIgnored guarantees the X-Grafana-User header
// is no longer trusted as a user-identity source. A spoofed header without a
// matching plugin context must return 401, not silently target another user's
// VM.
func TestHandleCodaExec_HeaderUserIsIgnored(t *testing.T) {
	app := newExecApp()
	req := httptest.NewRequest(http.MethodPost, "/coda/exec", strings.NewReader(`{"command":"true"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Grafana-User", "victim")
	rr := httptest.NewRecorder()
	app.handleCodaExec(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want %d (header-only identity must be rejected)", rr.Code, http.StatusUnauthorized)
	}
}

// ---------------------------------------------------------------------------
// findSSHClientForUser
// ---------------------------------------------------------------------------

func TestFindSSHClientForUser(t *testing.T) {
	app := newExecApp()
	// Empty cache returns nil.
	if c, _ := app.findSSHClientForUser("alice"); c != nil {
		t.Errorf("expected nil client for missing user, got %v", c)
	}

	// Different user does not match.
	app.streamSessions["terminal/vm1"] = &streamSession{
		vmID:      "vm1",
		userLogin: "bob",
		session:   &TerminalSession{VMID: "vm1"},
	}
	if c, _ := app.findSSHClientForUser("alice"); c != nil {
		t.Errorf("expected nil client when user does not match, got %v", c)
	}

	// Matching user returns the client (nil here, but vmID is reported).
	app.streamSessions["terminal/vm2"] = &streamSession{
		vmID:      "vm2",
		userLogin: "alice",
		session:   &TerminalSession{VMID: "vm2"},
	}
	_, vmID := app.findSSHClientForUser("alice")
	if vmID != "vm2" {
		t.Errorf("got vmID %q, want vm2", vmID)
	}
}

// ---------------------------------------------------------------------------
// runRemoteCommand — exercised against an in-process SSH server.
// ---------------------------------------------------------------------------

// testSSHServer is a minimal in-process SSH server used to verify the
// non-interactive exec path end-to-end (session create → run command →
// capture stdout/stderr → exit code).
type testSSHServer struct {
	t         *testing.T
	listener  net.Listener
	hostKey   ssh.Signer
	clientKey ssh.Signer
	handler   func(command string) (stdout, stderr string, exit int, delay time.Duration)
	wg        sync.WaitGroup
	closed    chan struct{}
}

func newTestSSHServer(t *testing.T) *testSSHServer {
	t.Helper()

	// Host key for the server.
	_, hostPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("host key: %v", err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("host signer: %v", err)
	}

	// Client key for the test client.
	_, clientPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("client key: %v", err)
	}
	clientSigner, err := ssh.NewSignerFromKey(clientPriv)
	if err != nil {
		t.Fatalf("client signer: %v", err)
	}

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	s := &testSSHServer{
		t:         t,
		listener:  lis,
		hostKey:   hostSigner,
		clientKey: clientSigner,
		closed:    make(chan struct{}),
	}
	s.wg.Add(1)
	go s.acceptLoop()
	return s
}

func (s *testSSHServer) close() {
	close(s.closed)
	_ = s.listener.Close()
	s.wg.Wait()
}

func (s *testSSHServer) acceptLoop() {
	defer s.wg.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.closed:
				return
			default:
				return
			}
		}
		s.wg.Add(1)
		go s.handleConn(conn)
	}
}

func (s *testSSHServer) handleConn(c net.Conn) {
	defer s.wg.Done()
	defer func() { _ = c.Close() }()

	config := &ssh.ServerConfig{
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			// Accept the configured client key.
			if bytes.Equal(key.Marshal(), s.clientKey.PublicKey().Marshal()) {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("unauthorized key")
		},
	}
	config.AddHostKey(s.hostKey)

	_, chans, reqs, err := ssh.NewServerConn(c, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			_ = newChan.Reject(ssh.UnknownChannelType, "only sessions")
			continue
		}
		ch, chReqs, err := newChan.Accept()
		if err != nil {
			continue
		}
		go s.handleSession(ch, chReqs)
	}
}

func (s *testSSHServer) handleSession(ch ssh.Channel, reqs <-chan *ssh.Request) {
	defer func() { _ = ch.Close() }()
	for req := range reqs {
		switch req.Type {
		case "exec":
			// Payload: 4-byte length + command string.
			if len(req.Payload) < 4 {
				_ = req.Reply(false, nil)
				continue
			}
			cmdLen := int(req.Payload[0])<<24 | int(req.Payload[1])<<16 | int(req.Payload[2])<<8 | int(req.Payload[3])
			if 4+cmdLen > len(req.Payload) {
				_ = req.Reply(false, nil)
				continue
			}
			command := string(req.Payload[4 : 4+cmdLen])
			_ = req.Reply(true, nil)

			stdout, stderr, exit, delay := s.handler(command)
			if delay > 0 {
				select {
				case <-time.After(delay):
				case <-s.closed:
				}
			}
			if stdout != "" {
				_, _ = io.WriteString(ch, stdout)
			}
			if stderr != "" {
				_, _ = io.WriteString(ch.Stderr(), stderr)
			}
			status := struct{ Status uint32 }{Status: uint32(exit)}
			_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(status))
			return
		default:
			_ = req.Reply(false, nil)
		}
	}
}

func (s *testSSHServer) dialClient(t *testing.T) *ssh.Client {
	t.Helper()
	config := &ssh.ClientConfig{
		User: "test",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(s.clientKey),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}
	client, err := ssh.Dial("tcp", s.listener.Addr().String(), config)
	if err != nil {
		t.Fatalf("ssh dial: %v", err)
	}
	return client
}

func TestRunRemoteCommand_Success(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		if cmd == "echo hi" {
			return "hi\n", "", 0, 0
		}
		return "", "unknown", 127, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	resp, err := runRemoteCommand(context.Background(), client, "echo hi", "raw")
	if err != nil {
		t.Fatalf("runRemoteCommand: %v", err)
	}
	if resp.Stdout != "hi\n" {
		t.Errorf("stdout=%q", resp.Stdout)
	}
	if resp.ExitCode != 0 {
		t.Errorf("exitCode=%d", resp.ExitCode)
	}
}

func TestRunRemoteCommand_NonZeroExit(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		return "", "boom\n", 42, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	resp, err := runRemoteCommand(context.Background(), client, "anything", "raw")
	if err != nil {
		t.Fatalf("runRemoteCommand: %v", err)
	}
	if resp.ExitCode != 42 {
		t.Errorf("exitCode=%d, want 42", resp.ExitCode)
	}
	if resp.Stderr != "boom\n" {
		t.Errorf("stderr=%q", resp.Stderr)
	}
}

func TestRunRemoteCommand_GatedMode(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	var received string
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		received = cmd
		return "wrapped\n", "", 0, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	_, err := runRemoteCommand(context.Background(), client, "echo inner", "gated")
	if err != nil {
		t.Fatalf("runRemoteCommand: %v", err)
	}
	if !strings.Contains(received, "[ -f "+codaSentinelPath+" ]") {
		t.Errorf("gated wrapper missing sentinel test; got %q", received)
	}
	if !strings.Contains(received, "echo inner") {
		t.Errorf("gated wrapper missing inner command; got %q", received)
	}
	if !strings.Contains(received, "bash -c") {
		t.Errorf("gated wrapper should invoke bash -c; got %q", received)
	}
}

// TestRunRemoteCommand_GatedMode_NoBreakout verifies that the gated wrapper
// keeps the user command inside its quoting context — a command with a
// trailing `)` cannot escape and run unconditionally.
func TestRunRemoteCommand_GatedMode_NoBreakout(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	var received string
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		received = cmd
		return "", "", 0, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	// The breakout attempt: previously this rendered as
	//   `[ -f sentinel ] && ( false ) ; echo hax # )`
	// and `echo hax` would run regardless of the sentinel.
	_, err := runRemoteCommand(context.Background(), client, `false ) ; echo hax #`, "gated")
	if err != nil {
		t.Fatalf("runRemoteCommand: %v", err)
	}
	// The whole malicious payload must remain inside a single-quoted bash -c arg.
	wantQuoted := `bash -c 'false ) ; echo hax #'`
	if !strings.Contains(received, wantQuoted) {
		t.Errorf("breakout attempt was not safely quoted\ngot:  %q\nwant containing: %q", received, wantQuoted)
	}
	// And the `echo hax` must NOT appear outside the single-quoted region — i.e.
	// no `; echo hax` directly attached to the gating `]`.
	if strings.Contains(received, "] ;") || strings.Contains(received, "]; echo") {
		t.Errorf("breakout chained a command outside the gate: %q", received)
	}
}

func TestRunRemoteCommand_Timeout(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		return "", "", 0, 2 * time.Second
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := runRemoteCommand(ctx, client, "sleep 2", "raw")
	if err == nil {
		t.Fatalf("expected timeout error, got nil")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error %q does not mention timeout", err.Error())
	}
}

func TestRunRemoteCommand_OutputTruncation(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()

	big := strings.Repeat("A", codaExecMaxOutputBytes+1024)
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		return big, "", 0, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	resp, err := runRemoteCommand(context.Background(), client, "blast", "raw")
	if err != nil {
		t.Fatalf("runRemoteCommand: %v", err)
	}
	if !resp.Truncated {
		t.Errorf("expected Truncated=true")
	}
	if len(resp.Stdout) != codaExecMaxOutputBytes {
		t.Errorf("stdout length=%d, want %d", len(resp.Stdout), codaExecMaxOutputBytes)
	}
}

// ---------------------------------------------------------------------------
// HTTP handler — happy path via in-process SSH server and a real streamSession.
// ---------------------------------------------------------------------------

func TestHandleCodaExec_HappyPath(t *testing.T) {
	srv := newTestSSHServer(t)
	defer srv.close()
	srv.handler = func(cmd string) (string, string, int, time.Duration) {
		return "ok\n", "", 0, 0
	}

	client := srv.dialClient(t)
	defer func() { _ = client.Close() }()

	app := newExecApp()
	app.streamSessions["terminal/vm-test"] = &streamSession{
		vmID:      "vm-test",
		userLogin: "alice",
		session:   &TerminalSession{VMID: "vm-test", SSHClient: client},
	}

	rr := postExec(t, app, `{"command":"true"}`, "alice")
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp CodaExecResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Stdout != "ok\n" || resp.ExitCode != 0 {
		t.Errorf("resp=%+v", resp)
	}
}

func TestHandleCodaExec_TimeoutClamping(t *testing.T) {
	// Send a timeout above the max; the handler should clamp it. We only need
	// to verify that the request completes without panicking and returns a
	// 4xx/5xx-aware response — actual behavior is observed by the unit test
	// of runRemoteCommand. Here, we exercise the parsing path.
	app := newExecApp()
	rr := postExec(t, app, `{"command":"true","timeoutMs":600000}`, "alice")
	// No session, so we get 409 either way — but no decode error from the
	// large timeout means parsing accepted it.
	if rr.Code != http.StatusConflict {
		t.Errorf("status=%d want 409 (timeout parsing should not error)", rr.Code)
	}
}

