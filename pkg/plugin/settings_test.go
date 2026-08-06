package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// The on-behalf-of settings contract with stack-state-service: the stack ID
// arrives in jsonData as "stackId" and the CAP token in secureJsonData as
// "accessToken" (see the pathfinder integration in that repo). A rename on
// either side silently disables the App Platform proxy routes.
func TestParseSettings_OBOCredentials(t *testing.T) {
	settings, err := ParseSettings(backend.AppInstanceSettings{
		JSONData:                []byte(`{"stackId":"42","codaApiUrl":"https://coda.example"}`),
		DecryptedSecureJSONData: map[string]string{"accessToken": "cap-token"},
	})
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if settings.StackID != "42" {
		t.Errorf("StackID = %q, want 42", settings.StackID)
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
	if settings.StackID != "" || settings.OBOToken != "" {
		t.Errorf("expected no OBO credentials, got stackID=%q token set=%v", settings.StackID, settings.OBOToken != "")
	}
}
