package resourceaccess

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

func SettingsConfig(config rest.Config) rest.Config {
	config = BoundedConfig(config, services.SettingsMaxBytes)
	config.Wrap(func(next http.RoundTripper) http.RoundTripper { return settingsErrorTransport{next: next} })
	return config
}

func BoundedConfig(config rest.Config, maxBytes int64) rest.Config {
	config.Wrap(func(next http.RoundTripper) http.RoundTripper {
		return settingsTransport{next: next, maxBytes: maxBytes}
	})
	return config
}

type settingsTransport struct {
	next     http.RoundTripper
	maxBytes int64
}

func (t settingsTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.next.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		_ = response.Body.Close()
		return nil, errors.New("settings upstream redirect refused")
	}
	limit := t.maxBytes
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		limit = 2048
	}
	response.Body = &boundedBody{ReadCloser: response.Body, remaining: limit, status: response.StatusCode}
	return response, nil
}

type boundedBody struct {
	io.ReadCloser
	remaining int64
	status    int
}

func (b *boundedBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining == 0 {
		var extra [1]byte
		n, err := b.ReadCloser.Read(extra[:])
		if n != 0 {
			if b.status >= 200 && b.status < 300 {
				return 0, &ResponseValidationError{Reason: "response-too-large", Status: b.status}
			}
			return 0, errors.New("settings upstream response too large")
		}
		return 0, err
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	return n, err
}

// ResponseValidationError retains the successful upstream status when its body is rejected.
type ResponseValidationError struct {
	Reason string
	Status int
}

func (e *ResponseValidationError) Error() string { return "invalid upstream response: " + e.Reason }

type settingsErrorTransport struct{ next http.RoundTripper }

func (t settingsErrorTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.next.RoundTrip(request)
	if err != nil || response.StatusCode < 400 {
		return response, err
	}
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 2049))
	_ = response.Body.Close()
	var status struct {
		Code int `json:"code"`
	}
	// SDK error decoding trusts the body code; a conflicting body cannot establish absence.
	if readErr != nil || len(body) > 2048 || (json.Unmarshal(body, &status) == nil && status.Code != response.StatusCode) {
		body = nil
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Del("Content-Length")
	return response, nil
}
