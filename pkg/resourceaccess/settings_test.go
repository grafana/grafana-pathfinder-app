package resourceaccess

import (
	"context"
	"encoding/json"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/k8s"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func TestRawSettingsPreservesUnknownFields(t *testing.T) {
	body := `{"metadata":{"resourceVersion":"42","futureMetadata":true},"spec":{"futureSetting":{"enabled":true}}}`
	object := &rawSettings{}
	if err := json.Unmarshal([]byte(body), object); err != nil {
		t.Fatal(err)
	}
	if string(object.body) != body {
		t.Fatalf("changed resource: %s", object.body)
	}
}

func TestRawSettingsRejectsOversizedResponse(t *testing.T) {
	object := &rawSettings{}
	if err := object.UnmarshalJSON([]byte(`{"spec":"` + strings.Repeat("x", services.SettingsMaxBytes) + `"}`)); err == nil {
		t.Fatal("accepted oversized response")
	}
}

func TestSettingsStoreReadsThroughSDKClient(t *testing.T) {
	body := `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"PathfinderSettings","metadata":{"name":"default","resourceVersion":"42"},"spec":{"futureField":true}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/pathfindersettings/default" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	store, err := NewSettingsStore(sdkplugin.BuildClientGenerator(rest.Config{Host: server.URL, APIPath: "/apis"}))
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.Read(context.Background(), "stacks-1")
	if err != nil || string(got) != body {
		t.Fatalf("body=%s error=%v", got, err)
	}
}

type callerInfo struct{ authlib.AuthInfo }

func (callerInfo) GetAccessToken() string { return "verified-caller-token" }
func (callerInfo) GetIDToken() string     { return "" }
func (callerInfo) GetNamespace() string   { return "stacks-1" }

func TestSettingsStoreDelegatesCallerThroughBoundedTransport(t *testing.T) {
	exchanged := false
	exchange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["subjectToken"] != "verified-caller-token" || body["namespace"] != "stacks-1" {
			t.Errorf("caller delegation missing: %v", body)
		}
		exchanged = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"token":"delegated-token"}}`))
	}))
	defer exchange.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Access-Token") != "delegated-token" {
			t.Error("missing delegated credential")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"metadata":{"name":"default"},"spec":{}}`))
	}))
	defer upstream.Close()
	config, err := k8s.NewTokenExchangeRestConfig(k8s.TokenExchangeCredentials{Token: "test-cap", TokenExchangeURL: exchange.URL}, k8s.RemoteServiceTarget{Host: upstream.URL, Audiences: []string{"grafana"}})
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewSettingsStore(sdkplugin.BuildClientGenerator(SettingsConfig(*config)))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Read(authlib.WithAuthInfo(context.Background(), callerInfo{}), "stacks-1")
	if err != nil {
		t.Fatal(err)
	}
	if !exchanged {
		t.Fatal("caller token was not exchanged")
	}
}
