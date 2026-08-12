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
}

// ParseSettings parses the plugin settings from Grafana's AppInstanceSettings.
func ParseSettings(appSettings backend.AppInstanceSettings) (*Settings, error) {
	settings := &Settings{}

	// Parse JSON settings
	if len(appSettings.JSONData) > 0 {
		if err := json.Unmarshal(appSettings.JSONData, settings); err != nil {
			return nil, err
		}
	}

	if oboToken, ok := appSettings.DecryptedSecureJSONData["accessToken"]; ok {
		settings.OBOToken = oboToken
	}

	return settings, nil
}
