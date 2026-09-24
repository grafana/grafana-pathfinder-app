package learningpaths

import _ "embed"

// The frontend picks one of these at runtime (paths-data.ts). Embedding them
// here is how the plugin backend resolves the same scaffold on a deployed
// stack, where the JSON is otherwise only inside the browser bundle.

//go:embed paths.json
var PathsJSON []byte

//go:embed paths-cloud.json
var PathsCloudJSON []byte
