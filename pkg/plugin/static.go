package plugin

import "embed"

// repositoryJSON holds the bundled guide catalog (repository.json).
//
//go:embed static/repository.json
var repositoryJSON []byte

// guidesFS holds all per-guide content.json files as static/guides/{id}.json.
//
//go:embed static/guides
var guidesFS embed.FS
