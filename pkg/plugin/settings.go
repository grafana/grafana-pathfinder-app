package plugin

import (
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
//
// jsonData is deliberately not unmarshalled: every field the backend reads lives
// in secureJsonData, and Settings maps nothing from JSON. Unmarshalling it anyway
// meant a malformed blob — written by the frontend config page, which owns that
// object — failed here and disabled the App Platform proxies over a value nothing
// reads. Restore the unmarshal if a field ever needs it, and tolerate a parse
// error rather than propagating it.
func ParseSettings(appSettings backend.AppInstanceSettings) (*Settings, error) {
	settings := &Settings{}

	if oboToken, ok := appSettings.DecryptedSecureJSONData["accessToken"]; ok {
		settings.OBOToken = oboToken
	}

	return settings, nil
}
