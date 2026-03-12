package plugin

import (
	"errors"
	"testing"
)

func TestIsUsableState(t *testing.T) {
	tests := []struct {
		state    string
		expected bool
	}{
		{"active", true},
		{"pending", true},
		{"provisioning", true},
		{"destroyed", false},
		{"destroying", false},
		{"error", false},
		{"", false},
		{"unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			result := isUsableState(tt.state)
			if result != tt.expected {
				t.Errorf("isUsableState(%q) = %v, want %v", tt.state, result, tt.expected)
			}
		})
	}
}

func TestIsVMNotFoundError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"VM not found error", errors.New("VM not found: abc-123"), true},
		{"generic error", errors.New("connection timeout"), false},
		{"auth error", errors.New("authentication failed"), false},
		{"partial match", errors.New("the VM not found message"), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isVMNotFoundError(tt.err)
			if result != tt.expected {
				t.Errorf("isVMNotFoundError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}
