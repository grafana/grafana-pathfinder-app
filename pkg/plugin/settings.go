package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Settings contains the plugin configuration from Grafana.
type Settings struct {
	// CodaRegistered indicates whether this instance has successfully registered with Coda
	CodaRegistered bool `json:"codaRegistered"`

	// CodaRelayURL is the WebSocket relay URL for SSH connections from Grafana Cloud.
	// When set, the plugin connects to VMs via the relay instead of direct SSH.
	// Format: wss://relay.lg.grafana-dev.com (no trailing slash)
	CodaRelayURL string `json:"codaRelayUrl"`

	// EnrollmentKey is the key used to register with the Coda API (from secureJsonData)
	EnrollmentKey string `json:"-"`

	// RefreshToken is the long-lived refresh token used to obtain short-lived access tokens.
	// Stored in secureJsonData. Never expires but can be revoked server-side.
	RefreshToken string `json:"-"`
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

	// Get secure settings (enrollment key, refresh token)
	if enrollmentKey, ok := appSettings.DecryptedSecureJSONData["codaEnrollmentKey"]; ok {
		settings.EnrollmentKey = enrollmentKey
	}
	if refreshToken, ok := appSettings.DecryptedSecureJSONData["codaRefreshToken"]; ok {
		settings.RefreshToken = refreshToken
	}

	return settings, nil
}
