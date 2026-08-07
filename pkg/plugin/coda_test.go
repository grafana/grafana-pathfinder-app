package plugin

import (
	"errors"
	"fmt"
	"net/http"
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
		{"upstream 404", &codaUpstreamError{status: http.StatusNotFound, msg: "VM not found: abc-123"}, true},
		{"wrapped upstream 404", fmt.Errorf("resolve: %w", &codaUpstreamError{status: http.StatusNotFound, msg: "VM not found: abc-123"}), true},
		{"generic error", errors.New("connection timeout"), false},
		{"auth error", errors.New("authentication failed"), false},
		{"prose-only not found message", errors.New("VM not found: abc-123"), false},
		{"upstream 500 with not-found text in body", &codaUpstreamError{status: http.StatusInternalServerError, msg: `unexpected status code 500: {"error":"VM not found in region"}`}, false},
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
