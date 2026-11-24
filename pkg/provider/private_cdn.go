package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/k8s"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/simple"
	"k8s.io/client-go/rest"
)

const (
	privateCDNAudience = "pathfinder-private-cdn-signer"
	privateCDNURL      = "http://pathfinder-private-cdn-signer.docs.svc.cluster.local.:8080"
	privateCDNGuide    = "builders-observability-foundations"
)

type privateCDNEntry struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Source string `json:"source"`
}

type privateCDNClient struct {
	namespace  string
	baseURL    string
	httpClient *http.Client
}

func privateCDNSDKEnv(key string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return os.Getenv(strings.TrimPrefix(key, "GF_"))
}

func privateCDNFromEnvironment() (*privateCDNClient, error) {
	namespace := os.Getenv("PATHFINDER_PRIVATE_CDN_NAMESPACE")
	if namespace == "" {
		return nil, nil
	}
	if !regexp.MustCompile(`^stacks-[0-9]+$`).MatchString(namespace) {
		return nil, errors.New("private CDN requires a concrete stack namespace")
	}
	cfg, err := k8s.NewTokenExchangeRestConfig(k8s.TokenExchangeCredentials{
		Token:            privateCDNSDKEnv(sdkplugin.EnvVarAPIAccessCAPToken),
		TokenExchangeURL: privateCDNSDKEnv(sdkplugin.EnvVarAPIAccessTokenExchangeURL),
	}, k8s.RemoteServiceTarget{Host: privateCDNURL, Audiences: []string{privateCDNAudience}, Namespace: namespace})
	if err != nil {
		return nil, errors.New("private CDN requires SDK token exchange credentials")
	}
	transport, err := rest.TransportFor(cfg)
	if err != nil {
		return nil, errors.New("cannot configure private CDN transport")
	}
	return &privateCDNClient{namespace: namespace, baseURL: privateCDNURL, httpClient: &http.Client{
		Transport:     transport,
		Timeout:       10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func privateCDNHandler(client *privateCDNClient, operation string) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		fail := func(status int, reason string) error {
			w.WriteHeader(status)
			return json.NewEncoder(w).Encode(map[string]string{"error": reason})
		}
		identity, ok := authlib.AuthInfoFrom(ctx)
		if !ok || identity == nil {
			return fail(http.StatusUnauthorized, "unauthenticated")
		}
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		principal, _, typeErr := authlib.ParseTypeID(identity.GetSubject())
		if err != nil || typeErr != nil || principal != authlib.TypeUser || (identity.GetAccessToken() == "" && identity.GetIDToken() == "") {
			return fail(http.StatusForbidden, "identity-unavailable")
		}
		if client == nil {
			return fail(http.StatusServiceUnavailable, "private-cdn-unavailable")
		}
		if namespace != client.namespace {
			return fail(http.StatusForbidden, "private-cdn-denied")
		}
		if req.URL != nil && (req.URL.RawQuery != "" || req.URL.RawPath != "") {
			return fail(http.StatusBadRequest, "invalid-request")
		}
		method := http.MethodGet
		var body []byte
		switch operation {
		case "identity":
			if req.Method != http.MethodGet {
				return fail(http.StatusMethodNotAllowed, "method-not-allowed")
			}
			return json.NewEncoder(w).Encode(map[string]string{"subject": identity.GetSubject(), "namespace": namespace})
		case "catalogue":
			if req.Method != method {
				return fail(http.StatusMethodNotAllowed, "method-not-allowed")
			}
		case "sign":
			method = http.MethodPost
			if req.Method != method {
				return fail(http.StatusMethodNotAllowed, "method-not-allowed")
			}
			if req.Body == nil {
				return fail(http.StatusBadRequest, "invalid-request")
			}
			body, err = io.ReadAll(io.LimitReader(req.Body, 1025))
			if err != nil || len(body) > 1024 {
				return fail(http.StatusBadRequest, "invalid-request")
			}
			var input struct {
				Guide string `json:"guide"`
				Asset string `json:"asset"`
			}
			d := json.NewDecoder(bytes.NewReader(body))
			d.DisallowUnknownFields()
			if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || input.Guide != privateCDNGuide || (input.Asset != "content.json" && input.Asset != "manifest.json") {
				return fail(http.StatusBadRequest, "invalid-request")
			}
		default:
			return fail(http.StatusNotFound, "not-found")
		}
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		outbound, err := http.NewRequestWithContext(ctx, method, client.baseURL+"/"+operation, bytes.NewReader(body))
		if err != nil {
			return fail(http.StatusBadGateway, "private-cdn-unavailable")
		}
		outbound.Header.Set("Content-Type", "application/json")
		response, err := client.httpClient.Do(outbound)
		if err != nil {
			return fail(http.StatusBadGateway, "private-cdn-unavailable")
		}
		defer func() { _ = response.Body.Close() }()
		switch response.StatusCode {
		case http.StatusOK:
		case http.StatusUnauthorized, http.StatusForbidden:
			return fail(response.StatusCode, "private-cdn-denied")
		case http.StatusTooManyRequests:
			return fail(http.StatusTooManyRequests, "private-cdn-rate-limited")
		default:
			return fail(http.StatusBadGateway, "private-cdn-unavailable")
		}
		payload, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
		if err != nil || len(payload) > 64*1024 || !json.Valid(payload) {
			return fail(http.StatusBadGateway, "private-cdn-unavailable")
		}
		if operation == "catalogue" {
			var entries []privateCDNEntry
			if json.Unmarshal(payload, &entries) != nil || entries == nil {
				return fail(http.StatusBadGateway, "private-cdn-unavailable")
			}
			for _, entry := range entries {
				if entry.ID != privateCDNGuide || entry.Source != "private-cdn" {
					return fail(http.StatusBadGateway, "private-cdn-unavailable")
				}
			}
			return json.NewEncoder(w).Encode(map[string]any{"entries": entries})
		}
		_, err = w.Write(payload)
		return err
	}
}
