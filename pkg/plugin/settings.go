package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Settings contains the plugin configuration from Grafana.
type Settings struct {
	// CodaRegistered indicates whether this instance has successfully registered with Coda
	CodaRegistered bool `json:"codaRegistered"`

	// EnrollmentKey is the key used to register with the Coda API (from secureJsonData)
	EnrollmentKey string `json:"-"`

	// JwtToken is the JWT token received after registration (from secureJsonData)
	JwtToken string `json:"-"`
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

	// Get secure settings (enrollment key, JWT token)
	if enrollmentKey, ok := appSettings.DecryptedSecureJSONData["codaEnrollmentKey"]; ok {
		settings.EnrollmentKey = enrollmentKey
	}
	if jwtToken, ok := appSettings.DecryptedSecureJSONData["codaJwtToken"]; ok {
		settings.JwtToken = jwtToken
	}

	return settings, nil
}
