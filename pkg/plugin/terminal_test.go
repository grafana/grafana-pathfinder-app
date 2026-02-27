package plugin

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestNormalizePrivateKey(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "already normalized key",
			input:    "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
		},
		{
			name:     "literal backslash-n from JSON",
			input:    "-----BEGIN OPENSSH PRIVATE KEY-----\\nbase64data\\n-----END OPENSSH PRIVATE KEY-----",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
		},
		{
			name:     "CRLF line endings",
			input:    "-----BEGIN OPENSSH PRIVATE KEY-----\r\nbase64data\r\n-----END OPENSSH PRIVATE KEY-----",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
		},
		{
			name:     "missing trailing newline",
			input:    "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
		},
		{
			name:     "extra whitespace around key",
			input:    "  -----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----  ",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----\n",
		},
		{
			name:     "mixed literal and real newlines",
			input:    "-----BEGIN OPENSSH PRIVATE KEY-----\\nline1\nline2\\n-----END OPENSSH PRIVATE KEY-----",
			expected: "-----BEGIN OPENSSH PRIVATE KEY-----\nline1\nline2\n-----END OPENSSH PRIVATE KEY-----\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizePrivateKey(tt.input)
			if result != tt.expected {
				t.Errorf("normalizePrivateKey() mismatch\ngot:  %q\nwant: %q", result, tt.expected)
			}
		})
	}
}

func TestNormalizePrivateKey_EndsWithNewline(t *testing.T) {
	inputs := []string{
		"key-without-newline",
		"key-with-newline\n",
		"key-with-crlf\r\n",
	}

	for _, input := range inputs {
		result := normalizePrivateKey(input)
		if !strings.HasSuffix(result, "\n") {
			t.Errorf("normalizePrivateKey(%q) should end with newline, got %q", input, result)
		}
	}
}

func TestCategorizeConnectionError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		resp     *http.Response
		expected string
	}{
		{
			name:     "403 forbidden response",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusForbidden},
			expected: "blocked_forbidden",
		},
		{
			name:     "401 unauthorized response",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusUnauthorized},
			expected: "blocked_unauthorized",
		},
		{
			name:     "502 bad gateway",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusBadGateway},
			expected: "relay_unavailable",
		},
		{
			name:     "503 service unavailable",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusServiceUnavailable},
			expected: "relay_unavailable",
		},
		{
			name:     "504 gateway timeout",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusGatewayTimeout},
			expected: "relay_unavailable",
		},
		{
			name:     "500 internal server error",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusInternalServerError},
			expected: "server_error",
		},
		{
			name:     "404 not found",
			err:      errors.New("websocket: bad handshake"),
			resp:     &http.Response{StatusCode: http.StatusNotFound},
			expected: "http_error_404",
		},
		{
			name:     "no response - connection refused",
			err:      errors.New("connection refused"),
			resp:     nil,
			expected: "connection_refused",
		},
		{
			name:     "no response - timeout",
			err:      errors.New("dial timeout"),
			resp:     nil,
			expected: "timeout",
		},
		{
			name:     "no response - deadline exceeded",
			err:      errors.New("context deadline exceeded"),
			resp:     nil,
			expected: "timeout",
		},
		{
			name:     "no response - dns error",
			err:      errors.New("no such host"),
			resp:     nil,
			expected: "dns_error",
		},
		{
			name:     "no response - connection reset",
			err:      errors.New("connection reset"),
			resp:     nil,
			expected: "connection_reset",
		},
		{
			name:     "no response - tls error",
			err:      errors.New("tls handshake failed"),
			resp:     nil,
			expected: "tls_error",
		},
		{
			name:     "no response - certificate error",
			err:      errors.New("certificate verify failed"),
			resp:     nil,
			expected: "tls_error",
		},
		{
			name:     "no response - network unreachable",
			err:      errors.New("network is unreachable"),
			resp:     nil,
			expected: "network_unreachable",
		},
		{
			name:     "no response - eof",
			err:      errors.New("unexpected eof"),
			resp:     nil,
			expected: "connection_closed",
		},
		{
			name:     "no response - unknown error",
			err:      errors.New("something weird happened"),
			resp:     nil,
			expected: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := categorizeConnectionError(tt.err, tt.resp)
			if result != tt.expected {
				t.Errorf("categorizeConnectionError(%v, %v) = %q, want %q", tt.err, tt.resp, result, tt.expected)
			}
		})
	}
}
