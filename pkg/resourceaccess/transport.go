package resourceaccess

import (
	"errors"
	"io"
	"net/http"

	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

func SettingsConfig(config rest.Config) rest.Config {
	return BoundedConfig(config, services.SettingsMaxBytes)
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
	response.Body = &boundedBody{ReadCloser: response.Body, remaining: limit}
	return response, nil
}

type boundedBody struct {
	io.ReadCloser
	remaining int64
}

func (b *boundedBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining == 0 {
		var extra [1]byte
		n, err := b.ReadCloser.Read(extra[:])
		if n != 0 {
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
