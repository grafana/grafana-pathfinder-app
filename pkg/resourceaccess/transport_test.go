package resourceaccess

import (
	"io"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBoundedBody(t *testing.T) {
	for _, tc := range []struct {
		name, input string
		limit       int64
		fails       bool
	}{
		{"below limit", "ab", 3, false},
		{"exact limit", "abc", 3, false},
		{"over limit", "abcd", 3, true},
		{"empty", "", 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := &boundedBody{ReadCloser: io.NopCloser(strings.NewReader(tc.input)), remaining: tc.limit}
			got, err := io.ReadAll(body)
			if (err != nil) != tc.fails {
				t.Fatalf("body=%q error=%v", got, err)
			}
			if int64(len(got)) > tc.limit {
				t.Fatal("read beyond limit")
			}
			if !tc.fails && string(got) != tc.input {
				t.Fatal("changed body")
			}
		})
	}
}

func TestSettingsTransportRefusesRedirect(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer server.Close()
	config := SettingsConfig(rest.Config{Host: server.URL})
	transport, err := rest.TransportFor(&config)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: transport}
	response, err := client.Get(server.URL)
	if response != nil {
		_ = response.Body.Close()
	}
	if err == nil || reached {
		t.Fatalf("redirect reached=%v error=%v", reached, err)
	}
}

func TestBoundedTransportKeepsOversizedErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(422)
		_, _ = io.WriteString(w, strings.Repeat("x", 4096))
	}))
	defer server.Close()
	config := BoundedConfig(rest.Config{Host: server.URL}, 128)
	tr, err := rest.TransportFor(&config)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := (&http.Client{Transport: tr}).Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) != 0 || resp.StatusCode != 422 {
		t.Fatalf("status=%d body=%d err=%v", resp.StatusCode, len(body), err)
	}
}
