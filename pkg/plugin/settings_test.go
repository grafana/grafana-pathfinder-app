package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// The on-behalf-of settings contract with stack-state-service: the CAP token
// arrives in secureJsonData as "accessToken" (see the pathfinder integration in
// that repo). A rename silently disables the App Platform proxy routes. The
// exchange namespace is taken from the request plugin-context, not from
// settings, so stackId is deliberately not parsed here.
func TestParseSettings_OBOCredentials(t *testing.T) {
	settings, err := ParseSettings(backend.AppInstanceSettings{
		JSONData:                []byte(`{"codaApiUrl":"https://coda.example"}`),
		DecryptedSecureJSONData: map[string]string{"accessToken": "cap-token"},
	})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if settings.OBOToken != "cap-token" {
		t.Errorf("OBOToken = %q, want cap-token", settings.OBOToken)
	}
}

func TestParseSettings_OBOCredentialsAbsent(t *testing.T) {
	settings, err := ParseSettings(backend.AppInstanceSettings{JSONData: []byte(`{}`)})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if settings.OBOToken != "" {
		t.Errorf("expected no OBO token, got token set=%v", settings.OBOToken != "")
	}
}
