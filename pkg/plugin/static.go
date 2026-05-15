package plugin

import "embed"

// guidesFS holds all per-guide content.json files as static/guides/{id}.json.
// Consumed by the launch_guide MCP tool for an existence check before queuing
// a pending launch. See pkg/plugin/mcp.go.
//
//go:embed static/guides
var guidesFS embed.FS
