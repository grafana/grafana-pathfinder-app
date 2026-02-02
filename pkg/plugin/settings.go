package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Settings contains the plugin configuration from Grafana.
type Settings struct {
	// BrokkrURL is the base URL for the Brokkr API
	BrokkrURL string `json:"brokkrUrl"`

	// BrokkrUsername is the username for Brokkr API authentication
	BrokkrUsername string `json:"brokkrUsername"`

	// BrokkrPassword is the password for Brokkr API authentication (from secureJsonData)
	BrokkrPassword string `json:"-"`
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

	// Get secure settings (passwords, API keys, etc.)
	if password, ok := appSettings.DecryptedSecureJSONData["brokkrPassword"]; ok {
		settings.BrokkrPassword = password
	}

	return settings, nil
}
