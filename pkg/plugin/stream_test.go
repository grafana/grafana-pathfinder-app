package plugin

import (
	"errors"
	"sync"
	"testing"
)

func TestIsSSHAuthError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"ssh authentication failed", errors.New("ssh authentication failed"), true},
		{"SSH Authentication Failed (case insensitive)", errors.New("SSH Authentication Failed"), true},
		{"auth_failed", errors.New("auth_failed"), true},
		{"could not authenticate", errors.New("could not authenticate user"), true},
		{"ssh handshake", errors.New("ssh handshake error"), true},
		{"unable to authenticate", errors.New("unable to authenticate"), true},
		{"permission denied", errors.New("permission denied"), true},
		{"Permission Denied (case insensitive)", errors.New("Permission Denied (publickey)"), true},
		{"unrelated timeout error", errors.New("connection timeout"), false},
		{"unrelated network error", errors.New("network unreachable"), false},
		{"empty error message", errors.New(""), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isSSHAuthError(tt.err)
			if result != tt.expected {
				t.Errorf("isSSHAuthError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}

func TestIsSSHRetryableError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"timeout", errors.New("connection timeout"), true},
		{"connection refused", errors.New("connection refused"), true},
		{"connection reset", errors.New("connection reset by peer"), true},
		{"no route to host", errors.New("no route to host"), true},
		{"i/o timeout", errors.New("i/o timeout"), true},
		{"eof", errors.New("unexpected eof"), true},
		{"broken pipe", errors.New("broken pipe"), true},
		{"ssh auth error (not retryable on same VM)", errors.New("permission denied"), false},
		{"ssh handshake (not retryable on same VM)", errors.New("ssh handshake failed"), false},
		{"generic error not retryable", errors.New("some random error"), false},
		{"empty error message", errors.New(""), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isSSHRetryableError(tt.err)
			if result != tt.expected {
				t.Errorf("isSSHRetryableError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}

func TestStatusMessageForState(t *testing.T) {
	tests := []struct {
		state    string
		expected string
	}{
		{"pending", "Waiting in queue..."},
		{"provisioning", "VM is booting..."},
		{"active", "VM is ready"},
		{"unknown", "VM state: unknown"},
		{"error", "VM state: error"},
		{"destroying", "VM state: destroying"},
		{"", "VM state: "},
	}

	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			result := statusMessageForState(tt.state)
			if result != tt.expected {
				t.Errorf("statusMessageForState(%q) = %q, want %q", tt.state, result, tt.expected)
			}
		})
	}
}

func TestClearUserVM(t *testing.T) {
	app := &App{
		userVMs: map[string]string{
			"alice": "vm-1",
			"bob":   "vm-2",
		},
		userVMsMu: sync.RWMutex{},
	}

	// Clearing with matching ID should remove the entry
	app.clearUserVM("alice", "vm-1")
	app.userVMsMu.RLock()
	_, exists := app.userVMs["alice"]
	app.userVMsMu.RUnlock()
	if exists {
		t.Error("clearUserVM should have removed alice's VM")
	}

	// Clearing with non-matching ID should be a no-op
	app.clearUserVM("bob", "vm-wrong")
	app.userVMsMu.RLock()
	bobVM := app.userVMs["bob"]
	app.userVMsMu.RUnlock()
	if bobVM != "vm-2" {
		t.Errorf("clearUserVM should not remove bob's VM when ID doesn't match, got %q", bobVM)
	}

	// Clearing a non-existent user should be safe
	app.clearUserVM("charlie", "vm-3")
}

func TestMaxUserVMsConstant(t *testing.T) {
	if maxUserVMs != 3 {
		t.Errorf("maxUserVMs should be 3, got %d", maxUserVMs)
	}
}

func TestSSHRetryConstants(t *testing.T) {
	if maxSSHRetries < 1 {
		t.Errorf("maxSSHRetries should be >= 1, got %d", maxSSHRetries)
	}
	if maxCredentialRefreshes < 1 {
		t.Errorf("maxCredentialRefreshes should be >= 1, got %d", maxCredentialRefreshes)
	}
}
