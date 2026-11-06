package constants

import (
	_ "embed"
	"encoding/json"
)

//go:embed bundled-tutorials.json
var bundledTutorialsJSON []byte

var bundledTutorialIDs = func() map[string]bool {
	var entries []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(bundledTutorialsJSON, &entries); err != nil {
		panic("invalid embedded bundled tutorial allowlist: " + err.Error())
	}
	ids := make(map[string]bool, len(entries))
	for _, entry := range entries {
		ids[entry.ID] = true
	}
	return ids
}()

func IsBundledTutorial(id string) bool {
	return bundledTutorialIDs[id]
}
