package learningpaths

import _ "embed"

//go:embed paths-cloud.json
var PathsCloudJSON []byte

//go:embed paths.json
var PathsOSSJSON []byte
