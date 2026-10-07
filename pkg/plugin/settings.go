package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Settings contains the plugin configuration from Grafana.
type Settings struct {
	// OBOToken is the per-stack Cloud Access Policy token provisioned by
	// stack-state-service into secureJsonData.accessToken. The App Platform proxy
	// routes exchange it for a short-lived on-behalf-of access token; the exchange
	// namespace comes from the request plugin-context, not from settings. Absent
	// on local dev and on stacks that predate provisioning.
	OBOToken string `json:"-"`

	// Tangelo holds the completion-webhook prototype's configuration
	// (tangelo_completion.go). Its secrets are provisioned per stack into
	// secureJsonData, never entered through the config page.
	Tangelo tangeloSettings `json:"-"`
}

// tangeloSettings is the Tangelo completion-webhook configuration. Token and
// ServiceAccountUserID are secrets: never log, return, or echo them.
type tangeloSettings struct {
	Enabled              bool
	Token                string
	ServiceAccountUserID string

	// EndpointOverride is honored only by builds tagged tangelodemo; every other
	// build posts to the fixed tangeloCompletionEndpoint.
	EndpointOverride string
}

func (s tangeloSettings) credentialsPresent() bool {
	return s.Token != "" && s.ServiceAccountUserID != ""
}

// active reports whether a completion should be sent to Tangelo.
func (s tangeloSettings) active() bool {
	return s.Enabled && s.credentialsPresent()
}

// pluginJSONData is the subset of jsonData the backend reads.
type pluginJSONData struct {
	TangeloCompletionEnabled  bool   `json:"tangeloCompletionEnabled"`
	TangeloCompletionEndpoint string `json:"tangeloCompletionEndpoint"`
}

// ParseSettings parses the plugin settings from Grafana's AppInstanceSettings.
//
// jsonData is written by the frontend config page, which owns that object, so a
// malformed blob is tolerated rather than propagated: propagating it once
// disabled the App Platform proxies over values they never read. A jsonData
// parse failure leaves every jsonData-derived setting at its zero value, which
// keeps the Tangelo webhook off.
func ParseSettings(appSettings backend.AppInstanceSettings) (*Settings, error) {
	settings := &Settings{}

	if oboToken, ok := appSettings.DecryptedSecureJSONData["accessToken"]; ok {
		settings.OBOToken = oboToken
	}

	var jsonData pluginJSONData
	if len(appSettings.JSONData) > 0 {
		if err := json.Unmarshal(appSettings.JSONData, &jsonData); err != nil {
			jsonData = pluginJSONData{}
		}
	}
	settings.Tangelo = tangeloSettings{
		Enabled:              jsonData.TangeloCompletionEnabled,
		Token:                appSettings.DecryptedSecureJSONData["tangeloCompletionToken"],
		ServiceAccountUserID: appSettings.DecryptedSecureJSONData["tangeloCompletionServiceAccountUserID"],
		EndpointOverride:     jsonData.TangeloCompletionEndpoint,
	}

	return settings, nil
}
