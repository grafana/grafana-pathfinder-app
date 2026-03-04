package plugin

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// validGuideIDPattern matches kebab-case guide IDs (lowercase alphanumeric + hyphens).
// Using an allowlist avoids path traversal and rejects IDs with dots, slashes, etc.
var validGuideIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// schemaVersionPattern matches semantic version strings (e.g., "1.0.0").
var schemaVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// ---------------------------------------------------------------------------
// Pending launch state
// ---------------------------------------------------------------------------

// PendingLaunch stores a guide launch queued for a specific user.
type PendingLaunch struct {
	GuideID     string    `json:"guideId"`
	RequestedAt time.Time `json:"requestedAt"`
}

var (
	pendingLaunches   = make(map[string]PendingLaunch)
	pendingLaunchesMu sync.Mutex
)

// ---------------------------------------------------------------------------
// MCP JSON-RPC types
// ---------------------------------------------------------------------------

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Standard JSON-RPC error codes.
const (
	errCodeParse    = -32700
	errCodeInvalid  = -32600
	errCodeNotFound = -32601
	errCodeParams   = -32602
	errCodeInternal = -32603
)

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

type mcpToolParam struct {
	Type        string                  `json:"type"`
	Description string                  `json:"description,omitempty"`
	Properties  map[string]mcpToolParam `json:"properties,omitempty"`
	Required    []string                `json:"required,omitempty"`
	Enum        []string                `json:"enum,omitempty"`
}

type mcpTool struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	InputSchema mcpToolParam `json:"inputSchema"`
}

var mcpTools = []mcpTool{
	{
		Name:        "list_guides",
		Description: "List all available Pathfinder guides with their metadata. Returns id, title, description, category, and type for each guide.",
		InputSchema: mcpToolParam{
			Type: "object",
			Properties: map[string]mcpToolParam{
				"category": {
					Type:        "string",
					Description: "Filter guides by category (e.g. 'data-sources', 'dashboards', 'getting-started')",
				},
				"type": {
					Type:        "string",
					Description: "Filter guides by type",
					Enum:        []string{"guide", "path", "journey"},
				},
			},
		},
	},
	{
		Name:        "get_guide",
		Description: "Retrieve the full content JSON for a specific guide by its ID.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"id"},
			Properties: map[string]mcpToolParam{
				"id": {
					Type:        "string",
					Description: "The guide ID (e.g. 'prometheus-grafana-101')",
				},
			},
		},
	},
	{
		Name:        "get_guide_schema",
		Description: "Retrieve the JSON Schema for a Pathfinder guide format. Useful for authoring and validating guide JSON.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"name"},
			Properties: map[string]mcpToolParam{
				"name": {
					Type:        "string",
					Description: "Schema name: 'content' (guide content.json), 'manifest' (manifest.json), or 'repository' (repository.json)",
					Enum:        []string{"content", "manifest", "repository"},
				},
			},
		},
	},
	{
		Name:        "launch_guide",
		Description: "Launch a Pathfinder guide for the current user. The guide will open automatically in the Pathfinder sidebar within a few seconds if the user has Grafana open.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"guideId"},
			Properties: map[string]mcpToolParam{
				"guideId": {
					Type:        "string",
					Description: "The ID of the guide to launch (e.g. 'prometheus-grafana-101'). Use list_guides to find valid IDs.",
				},
			},
		},
	},
	{
		Name:        "validate_guide_json",
		Description: "Validate a guide content.json string against the Pathfinder schema. Returns structured errors and warnings.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"content"},
			Properties: map[string]mcpToolParam{
				"content": {
					Type:        "string",
					Description: "The raw JSON string of a guide content.json to validate",
				},
			},
		},
	},
	{
		Name:        "create_guide_template",
		Description: "Generate a minimal valid guide skeleton (content.json and manifest.json) that passes schema validation.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"id", "title"},
			Properties: map[string]mcpToolParam{
				"id": {
					Type:        "string",
					Description: "Kebab-case guide ID (e.g. 'my-prometheus-guide')",
				},
				"title": {
					Type:        "string",
					Description: "Human-readable guide title",
				},
				"description": {
					Type:        "string",
					Description: "Short description of what the guide covers",
				},
				"category": {
					Type:        "string",
					Description: "Guide category (e.g. 'data-sources', 'dashboards'). Defaults to 'getting-started'.",
				},
			},
		},
	},
}

// ---------------------------------------------------------------------------
// handleMCP — entry point
// ---------------------------------------------------------------------------

func (a *App) handleMCP(w http.ResponseWriter, r *http.Request) {
	// Only POST for JSON-RPC
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeMCPError(w, nil, errCodeInvalid, "method not allowed: MCP endpoint only accepts POST")
		return
	}

	var req mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeMCPError(w, nil, errCodeParse, "parse error: "+err.Error())
		return
	}

	if req.JSONRPC != "2.0" {
		writeMCPError(w, req.ID, errCodeInvalid, "jsonrpc must be '2.0'")
		return
	}

	// Dispatch on method
	switch req.Method {
	case "initialize":
		writeMCPResult(w, req.ID, map[string]interface{}{
			"protocolVersion": "2025-03-26",
			"serverInfo": map[string]string{
				"name":    "grafana-pathfinder",
				"version": "1.0.0",
			},
			"capabilities": map[string]interface{}{
				"tools": map[string]bool{},
			},
		})
	case "ping":
		writeMCPResult(w, req.ID, map[string]interface{}{})
	case "tools/list":
		writeMCPResult(w, req.ID, map[string]interface{}{"tools": mcpTools})
	case "tools/call":
		a.handleToolCall(w, r, req)
	default:
		writeMCPError(w, req.ID, errCodeNotFound, fmt.Sprintf("method not found: %s", req.Method))
	}
}

// ---------------------------------------------------------------------------
// Tool call dispatcher
// ---------------------------------------------------------------------------

type toolCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func (a *App) handleToolCall(w http.ResponseWriter, r *http.Request, req mcpRequest) {
	var p toolCallParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writeMCPError(w, req.ID, errCodeParams, "invalid params: "+err.Error())
		return
	}

	// Get the Grafana user for per-user operations
	user := r.Header.Get("X-Grafana-User")
	if user == "" {
		user = "anonymous"
	}

	switch p.Name {
	case "list_guides":
		a.toolListGuides(w, req.ID, p.Arguments)
	case "get_guide":
		a.toolGetGuide(w, req.ID, p.Arguments)
	case "get_guide_schema":
		a.toolGetGuideSchema(w, req.ID, p.Arguments)
	case "launch_guide":
		a.toolLaunchGuide(w, req.ID, p.Arguments, user)
	case "validate_guide_json":
		a.toolValidateGuideJSON(w, req.ID, p.Arguments)
	case "create_guide_template":
		a.toolCreateGuideTemplate(w, req.ID, p.Arguments)
	default:
		writeMCPError(w, req.ID, errCodeNotFound, fmt.Sprintf("unknown tool: %s", p.Name))
	}
}

// ---------------------------------------------------------------------------
// Tool: list_guides
// ---------------------------------------------------------------------------

type listGuidesArgs struct {
	Category string `json:"category"`
	Type     string `json:"type"`
}

// repositoryEntry is the shape of a single entry in repository.json.
type repositoryEntry struct {
	Path             string            `json:"path"`
	Title            string            `json:"title"`
	Type             string            `json:"type"`
	Description      string            `json:"description"`
	Category         string            `json:"category"`
	StartingLocation string            `json:"startingLocation,omitempty"`
	Author           map[string]string `json:"author,omitempty"`
	Recommends       []string          `json:"recommends,omitempty"`
	Depends          []string          `json:"depends,omitempty"`
	Provides         []string          `json:"provides,omitempty"`
}

// guideListItem is what we return to the caller.
type guideListItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Type        string `json:"type"`
}

func (a *App) toolListGuides(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage) {
	var args listGuidesArgs
	if len(rawArgs) > 0 {
		_ = json.Unmarshal(rawArgs, &args)
	}

	// Parse repository.json
	var repo map[string]repositoryEntry
	if err := json.Unmarshal(repositoryJSON, &repo); err != nil {
		writeMCPError(w, id, errCodeInternal, "failed to parse guide repository: "+err.Error())
		return
	}

	guides := make([]guideListItem, 0, len(repo))
	for guideID, entry := range repo {
		if args.Category != "" && entry.Category != args.Category {
			continue
		}
		if args.Type != "" && entry.Type != args.Type {
			continue
		}
		guides = append(guides, guideListItem{
			ID:          guideID,
			Title:       entry.Title,
			Description: entry.Description,
			Category:    entry.Category,
			Type:        entry.Type,
		})
	}

	writeMCPResult(w, id, map[string]interface{}{
		"guides": guides,
		"total":  len(guides),
	})
}

// ---------------------------------------------------------------------------
// Tool: get_guide
// ---------------------------------------------------------------------------

type getGuideArgs struct {
	ID string `json:"id"`
}

func (a *App) toolGetGuide(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage) {
	var args getGuideArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil || args.ID == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'id' is missing or invalid")
		return
	}

	// Sanitize: guide IDs must be kebab-case (allowlist prevents path traversal)
	if !validGuideIDPattern.MatchString(args.ID) {
		writeMCPError(w, id, errCodeParams, "invalid guide ID: must be lowercase alphanumeric and hyphens only")
		return
	}

	contentPath := fmt.Sprintf("static/guides/%s.json", args.ID)
	data, err := fs.ReadFile(guidesFS, contentPath)
	if err != nil {
		writeMCPError(w, id, errCodeParams, fmt.Sprintf("guide not found: %s", args.ID))
		return
	}

	// Return the guide content as a parsed JSON value (not a string)
	var content interface{}
	if err := json.Unmarshal(data, &content); err != nil {
		writeMCPError(w, id, errCodeInternal, "failed to parse guide content")
		return
	}

	writeMCPResult(w, id, map[string]interface{}{
		"id":      args.ID,
		"content": content,
	})
}

// ---------------------------------------------------------------------------
// Tool: get_guide_schema
// ---------------------------------------------------------------------------

type getGuideSchemaArgs struct {
	Name string `json:"name"`
}

func (a *App) toolGetGuideSchema(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage) {
	var args getGuideSchemaArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil || args.Name == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'name' is missing (content | manifest | repository)")
		return
	}

	schema, ok := guideSchemas[args.Name]
	if !ok {
		writeMCPError(w, id, errCodeParams, fmt.Sprintf("unknown schema name: %s (valid: content, manifest, repository)", args.Name))
		return
	}

	writeMCPResult(w, id, map[string]interface{}{
		"name":   args.Name,
		"schema": schema,
	})
}

// guideSchemas contains inline JSON Schema definitions for the guide formats.
// These are intentionally simplified summaries; the canonical source of truth
// is the Zod schemas in src/types/. Run `npm run schema:export` for full schemas.
var guideSchemas = map[string]interface{}{
	"content": map[string]interface{}{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"type":        "object",
		"description": "Pathfinder guide content.json schema",
		"required":    []string{"schemaVersion", "id", "title", "blocks"},
		"properties": map[string]interface{}{
			"schemaVersion": map[string]interface{}{
				"type":        "string",
				"pattern":     `^\d+\.\d+\.\d+$`,
				"description": "Schema version, currently '1.0.0'",
			},
			"id": map[string]interface{}{
				"type":        "string",
				"description": "Unique kebab-case guide identifier",
				"pattern":     `^[a-z0-9]+(-[a-z0-9]+)*$`,
			},
			"title": map[string]interface{}{
				"type":        "string",
				"description": "Human-readable guide title",
			},
			"blocks": map[string]interface{}{
				"type":        "array",
				"description": "Ordered list of content blocks",
				"items": map[string]interface{}{
					"type":     "object",
					"required": []string{"type"},
					"properties": map[string]interface{}{
						"type": map[string]interface{}{
							"type": "string",
							// Must match JsonBlock union in src/types/json-guide.types.ts
							"enum": []string{
								"markdown", "html", "section", "conditional", "interactive",
								"multistep", "guided", "image", "video", "quiz", "assistant",
								"input", "terminal",
							},
						},
					},
				},
			},
		},
	},
	"manifest": map[string]interface{}{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"type":        "object",
		"description": "Pathfinder guide manifest.json schema",
		"required":    []string{"id", "title", "type", "category"},
		"properties": map[string]interface{}{
			"id":    map[string]interface{}{"type": "string"},
			"title": map[string]interface{}{"type": "string"},
			"type": map[string]interface{}{
				"type": "string",
				"enum": []string{"guide", "path", "journey"},
			},
			"category":         map[string]interface{}{"type": "string"},
			"description":      map[string]interface{}{"type": "string"},
			"startingLocation": map[string]interface{}{"type": "string"},
		},
	},
	"repository": map[string]interface{}{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"type":        "object",
		"description": "Pathfinder repository.json: a map of guide IDs to manifest entries",
		"additionalProperties": map[string]interface{}{
			"$ref": "#/$defs/manifest",
		},
		"$defs": map[string]interface{}{
			"manifest": map[string]interface{}{
				"type":     "object",
				"required": []string{"path", "title", "type", "category"},
				"properties": map[string]interface{}{
					"path":             map[string]interface{}{"type": "string"},
					"title":            map[string]interface{}{"type": "string"},
					"type":             map[string]interface{}{"type": "string"},
					"category":         map[string]interface{}{"type": "string"},
					"description":      map[string]interface{}{"type": "string"},
					"startingLocation": map[string]interface{}{"type": "string"},
				},
			},
		},
	},
}

// ---------------------------------------------------------------------------
// Tool: launch_guide
// ---------------------------------------------------------------------------

type launchGuideArgs struct {
	GuideID string `json:"guideId"`
}

func (a *App) toolLaunchGuide(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage, user string) {
	var args launchGuideArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil || args.GuideID == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'guideId' is missing or invalid")
		return
	}

	// Validate that the guide exists
	if !validGuideIDPattern.MatchString(args.GuideID) {
		writeMCPError(w, id, errCodeParams, "invalid guide ID: must be lowercase alphanumeric and hyphens only")
		return
	}
	contentPath := fmt.Sprintf("static/guides/%s.json", args.GuideID)
	if _, err := fs.Stat(guidesFS, contentPath); err != nil {
		writeMCPError(w, id, errCodeParams, fmt.Sprintf("guide not found: %s — use list_guides to see available IDs", args.GuideID))
		return
	}

	// Store pending launch for this user
	pendingLaunchesMu.Lock()
	pendingLaunches[user] = PendingLaunch{
		GuideID:     args.GuideID,
		RequestedAt: time.Now(),
	}
	pendingLaunchesMu.Unlock()

	a.logger.Info("Guide launch queued", "user", user, "guideId", args.GuideID)

	writeMCPResult(w, id, map[string]interface{}{
		"status":  "queued",
		"guideId": args.GuideID,
		"message": fmt.Sprintf("Guide '%s' will open in the Pathfinder sidebar within a few seconds.", args.GuideID),
	})
}

// ---------------------------------------------------------------------------
// Tool: validate_guide_json
// ---------------------------------------------------------------------------

type validateGuideArgs struct {
	Content string `json:"content"`
}

type validationIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

func (a *App) toolValidateGuideJSON(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage) {
	var args validateGuideArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil || args.Content == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'content' is missing or invalid")
		return
	}

	var errs []validationIssue
	var warnings []validationIssue

	// 1. Parse JSON
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(args.Content), &parsed); err != nil {
		writeMCPResult(w, id, map[string]interface{}{
			"isValid":  false,
			"errors":   []validationIssue{{Path: "", Message: "invalid JSON: " + err.Error()}},
			"warnings": []validationIssue{},
		})
		return
	}

	// 2. Check required top-level fields
	requiredFields := []string{"schemaVersion", "id", "title", "blocks"}
	for _, field := range requiredFields {
		if _, ok := parsed[field]; !ok {
			errs = append(errs, validationIssue{Path: field, Message: fmt.Sprintf("required field '%s' is missing", field)})
		}
	}

	// 3. Validate schemaVersion is a semver string (any version is accepted)
	if sv, ok := parsed["schemaVersion"].(string); ok {
		if !schemaVersionPattern.MatchString(sv) {
			errs = append(errs, validationIssue{
				Path:    "schemaVersion",
				Message: fmt.Sprintf("schemaVersion '%s' must be a semver string (e.g. '1.0.0')", sv),
			})
		}
	} else if _, hasField := parsed["schemaVersion"]; hasField {
		errs = append(errs, validationIssue{Path: "schemaVersion", Message: "schemaVersion must be a string"})
	}

	// 4. Validate id is a non-empty string
	if idVal, ok := parsed["id"].(string); ok {
		if idVal == "" {
			errs = append(errs, validationIssue{Path: "id", Message: "id must not be empty"})
		}
	} else if _, hasField := parsed["id"]; hasField {
		errs = append(errs, validationIssue{Path: "id", Message: "id must be a string"})
	}

	// 5. Validate title is a non-empty string
	if titleVal, ok := parsed["title"].(string); ok {
		if titleVal == "" {
			errs = append(errs, validationIssue{Path: "title", Message: "title must not be empty"})
		}
	} else if _, hasField := parsed["title"]; hasField {
		errs = append(errs, validationIssue{Path: "title", Message: "title must be a string"})
	}

	// 6. Validate blocks is an array
	if blocksVal, ok := parsed["blocks"]; ok {
		blocks, isArray := blocksVal.([]interface{})
		if !isArray {
			errs = append(errs, validationIssue{Path: "blocks", Message: "blocks must be an array"})
		} else {
			// Check each block has a valid type field.
			// This list must match the JsonBlock union in src/types/json-guide.types.ts.
			validBlockTypes := map[string]bool{
				"markdown": true, "html": true, "section": true, "conditional": true,
				"interactive": true, "multistep": true, "guided": true, "image": true,
				"video": true, "quiz": true, "assistant": true, "input": true, "terminal": true,
			}
			for i, block := range blocks {
				blockMap, ok := block.(map[string]interface{})
				if !ok {
					errs = append(errs, validationIssue{
						Path:    fmt.Sprintf("blocks[%d]", i),
						Message: "each block must be an object",
					})
					continue
				}
				blockType, ok := blockMap["type"].(string)
				if !ok {
					errs = append(errs, validationIssue{
						Path:    fmt.Sprintf("blocks[%d].type", i),
						Message: "block must have a 'type' string field",
					})
					continue
				}
				if !validBlockTypes[blockType] {
					errs = append(errs, validationIssue{
						Path:    fmt.Sprintf("blocks[%d].type", i),
						Message: fmt.Sprintf("unknown block type '%s'", blockType),
					})
				}
			}
		}
	}

	if errs == nil {
		errs = []validationIssue{}
	}
	if warnings == nil {
		warnings = []validationIssue{}
	}

	writeMCPResult(w, id, map[string]interface{}{
		"isValid":  len(errs) == 0,
		"errors":   errs,
		"warnings": warnings,
	})
}

// ---------------------------------------------------------------------------
// Tool: create_guide_template
// ---------------------------------------------------------------------------

type createGuideTemplateArgs struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

func (a *App) toolCreateGuideTemplate(w http.ResponseWriter, id json.RawMessage, rawArgs json.RawMessage) {
	var args createGuideTemplateArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		writeMCPError(w, id, errCodeParams, "invalid parameters: "+err.Error())
		return
	}
	if args.ID == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'id' is missing")
		return
	}
	if args.Title == "" {
		writeMCPError(w, id, errCodeParams, "required parameter 'title' is missing")
		return
	}
	if args.Category == "" {
		args.Category = "getting-started"
	}
	if args.Description == "" {
		args.Description = args.Title
	}

	// Build content.json template
	contentTemplate := map[string]interface{}{
		"schemaVersion": "1.0.0",
		"id":            args.ID,
		"title":         args.Title,
		"blocks": []interface{}{
			map[string]interface{}{
				"type":    "markdown",
				"content": fmt.Sprintf("# %s\n\n%s\n\nThis guide will walk you through the steps below.", args.Title, args.Description),
			},
			map[string]interface{}{
				"type":  "section",
				"id":    "step-1",
				"title": "Step 1",
				"blocks": []interface{}{
					map[string]interface{}{
						"type":    "markdown",
						"content": "Describe what to do in step 1.",
					},
				},
			},
		},
	}

	// Build manifest.json template
	manifestTemplate := map[string]interface{}{
		"id":               args.ID,
		"path":             args.ID + "/",
		"title":            args.Title,
		"type":             "guide",
		"description":      args.Description,
		"category":         args.Category,
		"startingLocation": "/",
		"author": map[string]string{
			"name": "Your Name",
			"team": "Your Team",
		},
		"testEnvironment": map[string]interface{}{
			"tier":       "local",
			"minVersion": "12.2.0",
		},
	}

	contentJSON, _ := json.MarshalIndent(contentTemplate, "", "  ")
	manifestJSON, _ := json.MarshalIndent(manifestTemplate, "", "  ")

	writeMCPResult(w, id, map[string]interface{}{
		"contentJson":  string(contentJSON),
		"manifestJson": string(manifestJSON),
		"instructions": fmt.Sprintf(
			"Create a directory src/bundled-interactives/%s/ and save the above as content.json and manifest.json respectively. Then run 'npm run validate:packages' to check your guide.",
			args.ID,
		),
	})
}

// ---------------------------------------------------------------------------
// Pending launch REST endpoints (for frontend polling)
// ---------------------------------------------------------------------------

// handlePendingLaunch handles GET /mcp/pending-launch and POST /mcp/pending-launch/clear.
func (a *App) handlePendingLaunch(w http.ResponseWriter, r *http.Request) {
	user := r.Header.Get("X-Grafana-User")
	if user == "" {
		user = "anonymous"
	}

	path := strings.TrimPrefix(r.URL.Path, "/mcp/pending-launch")

	switch {
	case r.Method == http.MethodGet && path == "":
		a.getPendingLaunch(w, user)
	case r.Method == http.MethodPost && path == "/clear":
		a.clearPendingLaunch(w, user)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (a *App) getPendingLaunch(w http.ResponseWriter, user string) {
	pendingLaunchesMu.Lock()
	launch, ok := pendingLaunches[user]

	// Auto-expire launches older than 5 minutes
	if ok && time.Since(launch.RequestedAt) > 5*time.Minute {
		delete(pendingLaunches, user)
		ok = false
	}
	pendingLaunchesMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if !ok {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"guideId": launch.GuideID,
	})
}

func (a *App) clearPendingLaunch(w http.ResponseWriter, user string) {
	pendingLaunchesMu.Lock()
	delete(pendingLaunches, user)
	pendingLaunchesMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func writeMCPResult(w http.ResponseWriter, id json.RawMessage, result interface{}) {
	resp := mcpResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func writeMCPError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	resp := mcpResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &mcpError{Code: code, Message: message},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
