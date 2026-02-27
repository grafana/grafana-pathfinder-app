package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Settings contains the plugin configuration from Grafana.
type Settings struct {
	CodaRegistered bool   `json:"codaRegistered"`
	CodaAPIURL     string `json:"codaApiUrl"`
	CodaRelayURL   string `json:"codaRelayUrl"`
	EnrollmentKey  string `json:"-"`
	RefreshToken   string `json:"-"`
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
