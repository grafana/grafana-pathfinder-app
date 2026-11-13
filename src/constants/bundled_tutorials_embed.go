package constants

import (
	_ "embed"
	"encoding/json"
)

//go:embed bundled-tutorials.json
var bundledTutorialsJSON []byte

var bundledTutorialIDs = func() map[string]string {
	var entries []struct {
		ID             string `json:"id"`
		LegacyOnlineID string `json:"legacyOnlineId"`
	}
	if err := json.Unmarshal(bundledTutorialsJSON, &entries); err != nil {
		panic("invalid embedded bundled tutorial allowlist: " + err.Error())
	}
	ids := make(map[string]string, len(entries))
	for _, entry := range entries {
		ids[entry.ID] = entry.LegacyOnlineID
	}
	return ids
}()

func IsBundledTutorial(id string) bool {
	_, ok := bundledTutorialIDs[id]
	return ok
}

func LegacyOnlineTutorialID(id string) string {
	return bundledTutorialIDs[id]
}
