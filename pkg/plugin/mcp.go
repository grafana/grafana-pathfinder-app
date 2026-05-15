package plugin

// Status: in-process runtime endpoint.
//
// After MH4 phase C (2026-05-15), this file hosts only the launch_guide tool
// and the per-instance pending-launch queue. launch_guide is coupled to the
// per-instance frontend polling hook (src/hooks/usePendingGuideLaunch.ts) and
// cannot move to the centrally-hosted TypeScript MCP server in src/cli/mcp/.
//
// All other MCP authoring tools (list_packages, get_package, validate,
// get_schema, create_guide_template, etc.) now live in the TS MCP. See
// docs/developer/MCP_SERVER.md and docs/design/HOSTED-AUTHORING-MCP.md.

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
		Name:        "launch_guide",
		Description: "Launch a Pathfinder guide for the current user. The guide will open automatically in the Pathfinder sidebar within a few seconds if the user has Grafana open.",
		InputSchema: mcpToolParam{
			Type:     "object",
			Required: []string{"guideId"},
			Properties: map[string]mcpToolParam{
				"guideId": {
					Type:        "string",
					Description: "The ID of the guide to launch (e.g. 'prometheus-grafana-101').",
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
	case "launch_guide":
		a.toolLaunchGuide(w, req.ID, p.Arguments, user)
	default:
		writeMCPError(w, req.ID, errCodeNotFound, fmt.Sprintf("unknown tool: %s", p.Name))
	}
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

	// Validate the guide ID shape (kebab-case allowlist; no path traversal).
	if !validGuideIDPattern.MatchString(args.GuideID) {
		writeMCPError(w, id, errCodeParams, "invalid guide ID: must be lowercase alphanumeric and hyphens only")
		return
	}

	// Defense-in-depth: confirm the guide exists in the bundled fallback set
	// before queuing. The frontend resolves online content too, but a sync
	// reject here is cheap and avoids silently queuing a typo.
	contentPath := fmt.Sprintf("static/guides/%s.json", args.GuideID)
	if _, err := fs.Stat(guidesFS, contentPath); err != nil {
		writeMCPToolError(w, id, fmt.Sprintf("guide not found: %s", args.GuideID))
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

	writeMCPToolResult(w, id, map[string]interface{}{
		"status":  "queued",
		"guideId": args.GuideID,
		"message": fmt.Sprintf("Guide '%s' will open in the Pathfinder sidebar within a few seconds.", args.GuideID),
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
		a.writeError(w, "not found", http.StatusNotFound)
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

// writeMCPResult writes a raw JSON-RPC result (used for protocol-level responses:
// initialize, ping, tools/list). Tool call results must use writeMCPToolResult.
func writeMCPResult(w http.ResponseWriter, id json.RawMessage, result interface{}) {
	resp := mcpResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// writeMCPToolResult writes a tools/call success response per the MCP spec:
// result.content must be an array of typed content items.
func writeMCPToolResult(w http.ResponseWriter, id json.RawMessage, data interface{}) {
	text, err := json.Marshal(data)
	if err != nil {
		writeMCPToolError(w, id, "internal error: failed to serialize result")
		return
	}
	writeMCPResult(w, id, map[string]interface{}{
		"content": []map[string]string{
			{"type": "text", "text": string(text)},
		},
	})
}

// writeMCPToolError writes a tools/call error response per the MCP spec:
// tool execution failures are returned as isError:true content, not JSON-RPC errors.
func writeMCPToolError(w http.ResponseWriter, id json.RawMessage, message string) {
	writeMCPResult(w, id, map[string]interface{}{
		"content": []map[string]string{
			{"type": "text", "text": message},
		},
		"isError": true,
	})
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
