package learningpaths

import _ "embed"

// The plugin backend evaluates assignments against the Cloud catalogue only:
// assignments live on App Platform, which only Grafana Cloud serves. The
// frontend picks between paths.json and paths-cloud.json at runtime
// (paths-data.ts).

//go:embed paths-cloud.json
var PathsCloudJSON []byte
