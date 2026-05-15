package plugin

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func newMCPPost(t *testing.T, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func newMCPPostWithUser(t *testing.T, body, user string) *http.Request {
	t.Helper()
	req := newMCPPost(t, body)
	req.Header.Set("X-Grafana-User", user)
	return req
}

func callMCP(t *testing.T, app *App, req *http.Request) map[string]interface{} {
	t.Helper()
	rr := httptest.NewRecorder()
	app.handleMCP(rr, req)
	var out map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("response is not valid JSON: %v\nbody: %s", err, rr.Body.String())
	}
	return out
}

func mcpToolCall(t *testing.T, app *App, toolName string, args map[string]interface{}) map[string]interface{} {
	t.Helper()
	return mcpToolCallWithUser(t, app, toolName, args, "testuser")
}

func mcpToolCallWithUser(t *testing.T, app *App, toolName string, args map[string]interface{}, user string) map[string]interface{} {
	t.Helper()
	argsJSON, _ := json.Marshal(args)
	body, _ := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name":      toolName,
			"arguments": json.RawMessage(argsJSON),
		},
	})
	req := newMCPPostWithUser(t, string(body), user)
	return callMCP(t, app, req)
}

func newTestApp(t *testing.T) *App {
	t.Helper()
	return &App{logger: log.DefaultLogger}
}

// extractToolData parses the tool result from a tools/call response.
// Per MCP spec, tool results are wrapped in result.content[0].text.
func extractToolData(t *testing.T, out map[string]interface{}) map[string]interface{} {
	t.Helper()
	result, ok := out["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("no result in response: %v", out)
	}
	content, ok := result["content"].([]interface{})
	if !ok || len(content) == 0 {
		t.Fatalf("no content array in tool result: %v", result)
	}
	item := content[0].(map[string]interface{})
	text, _ := item["text"].(string)
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(text), &data); err != nil {
		t.Fatalf("failed to parse tool result text as JSON: %v\ntext: %s", err, text)
	}
	return data
}

// isToolError returns true if the response is a JSON-RPC protocol error
// or a tool-level execution error (isError:true in result content).
func isToolError(out map[string]interface{}) bool {
	if out["error"] != nil {
		return true
	}
	result, _ := out["result"].(map[string]interface{})
	if result == nil {
		return false
	}
	isError, _ := result["isError"].(bool)
	return isError
}

// ---------------------------------------------------------------------------
// handleMCP — protocol tests
// ---------------------------------------------------------------------------

func TestHandleMCP_RejectsNonPOST(t *testing.T) {
	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	rr := httptest.NewRecorder()
	app.handleMCP(rr, req)

	var out map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("expected JSON response for non-POST, got: %s", rr.Body.String())
	}
	if out["error"] == nil {
		t.Error("expected error field in response for non-POST request")
	}
}

func TestHandleMCP_RejectsInvalidJSON(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, "not json")
	out := callMCP(t, app, req)
	if out["error"] == nil {
		t.Error("expected error for invalid JSON body")
	}
}

func TestHandleMCP_RejectsWrongJSONRPCVersion(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, `{"jsonrpc":"1.0","id":1,"method":"tools/list"}`)
	out := callMCP(t, app, req)
	if out["error"] == nil {
		t.Error("expected error for wrong jsonrpc version")
	}
}

func TestHandleMCP_Initialize(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	out := callMCP(t, app, req)
	if out["error"] != nil {
		t.Errorf("unexpected error: %v", out["error"])
	}
	result, ok := out["result"].(map[string]interface{})
	if !ok {
		t.Fatal("expected result object")
	}
	if result["protocolVersion"] == nil {
		t.Error("expected protocolVersion in initialize result")
	}
}

func TestHandleMCP_Ping(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, `{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	out := callMCP(t, app, req)
	if out["error"] != nil {
		t.Errorf("unexpected error: %v", out["error"])
	}
}

func TestHandleMCP_UnknownMethod(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, `{"jsonrpc":"2.0","id":1,"method":"nonexistent/method"}`)
	out := callMCP(t, app, req)
	if out["error"] == nil {
		t.Error("expected error for unknown method")
	}
}

// ---------------------------------------------------------------------------
// tools/list — post-MH4 the Go endpoint exposes a single tool.
// ---------------------------------------------------------------------------

func TestToolsList(t *testing.T) {
	app := newTestApp(t)
	req := newMCPPost(t, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	out := callMCP(t, app, req)
	if out["error"] != nil {
		t.Fatalf("unexpected error: %v", out["error"])
	}
	result := out["result"].(map[string]interface{})
	tools := result["tools"].([]interface{})
	if len(tools) != 1 {
		t.Fatalf("expected exactly one tool (launch_guide), got %d", len(tools))
	}
	tool := tools[0].(map[string]interface{})
	if name := tool["name"]; name != "launch_guide" {
		t.Errorf("expected only tool to be 'launch_guide', got %q", name)
	}
}

// ---------------------------------------------------------------------------
// launch_guide
// ---------------------------------------------------------------------------

func TestToolLaunchGuide_ValidID(t *testing.T) {
	// Clear any existing pending launches
	pendingLaunchesMu.Lock()
	delete(pendingLaunches, "testuser")
	pendingLaunchesMu.Unlock()

	app := newTestApp(t)
	out := mcpToolCallWithUser(t, app, "launch_guide", map[string]interface{}{"guideId": "first-dashboard"}, "testuser")
	if isToolError(out) {
		t.Fatalf("unexpected error: %v", out)
	}
	data := extractToolData(t, out)
	if data["status"] != "queued" {
		t.Errorf("expected status 'queued', got %v", data["status"])
	}

	// Verify it was stored
	pendingLaunchesMu.Lock()
	launch, ok := pendingLaunches["testuser"]
	pendingLaunchesMu.Unlock()
	if !ok {
		t.Error("expected pending launch to be stored")
	}
	if launch.GuideID != "first-dashboard" {
		t.Errorf("expected guideId 'first-dashboard', got %q", launch.GuideID)
	}
}

func TestToolLaunchGuide_UnknownID(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "launch_guide", map[string]interface{}{"guideId": "does-not-exist"})
	if !isToolError(out) {
		t.Error("expected error for unknown guide ID")
	}
}

func TestToolLaunchGuide_InvalidID(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "launch_guide", map[string]interface{}{"guideId": "../etc/passwd"})
	if !isToolError(out) {
		t.Error("expected error for invalid guide ID")
	}
}

// ---------------------------------------------------------------------------
// pending launch REST endpoints
// ---------------------------------------------------------------------------

func TestGetPendingLaunch_Empty(t *testing.T) {
	pendingLaunchesMu.Lock()
	delete(pendingLaunches, "polltestuser")
	pendingLaunchesMu.Unlock()

	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/mcp/pending-launch", nil)
	req.Header.Set("X-Grafana-User", "polltestuser")
	rr := httptest.NewRecorder()
	app.handlePendingLaunch(rr, req)

	var out map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected empty object, got %v", out)
	}
}

func TestGetPendingLaunch_WithPending(t *testing.T) {
	pendingLaunchesMu.Lock()
	pendingLaunches["polltestuser2"] = PendingLaunch{GuideID: "welcome-to-grafana", RequestedAt: time.Now()}
	pendingLaunchesMu.Unlock()
	t.Cleanup(func() {
		pendingLaunchesMu.Lock()
		delete(pendingLaunches, "polltestuser2")
		pendingLaunchesMu.Unlock()
	})

	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/mcp/pending-launch", nil)
	req.Header.Set("X-Grafana-User", "polltestuser2")
	rr := httptest.NewRecorder()
	app.handlePendingLaunch(rr, req)

	var out map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if out["guideId"] != "welcome-to-grafana" {
		t.Errorf("expected guideId 'welcome-to-grafana', got %v", out["guideId"])
	}
}

func TestGetPendingLaunch_Expired(t *testing.T) {
	pendingLaunchesMu.Lock()
	pendingLaunches["expireduser"] = PendingLaunch{
		GuideID:     "first-dashboard",
		RequestedAt: time.Now().Add(-6 * time.Minute), // over 5-min expiry
	}
	pendingLaunchesMu.Unlock()

	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/mcp/pending-launch", nil)
	req.Header.Set("X-Grafana-User", "expireduser")
	rr := httptest.NewRecorder()
	app.handlePendingLaunch(rr, req)

	var out map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected empty object for expired launch, got %v", out)
	}

	// Verify it was cleaned up
	pendingLaunchesMu.Lock()
	_, stillPresent := pendingLaunches["expireduser"]
	pendingLaunchesMu.Unlock()
	if stillPresent {
		t.Error("expired launch should have been removed from map")
	}
}

func TestClearPendingLaunch(t *testing.T) {
	pendingLaunchesMu.Lock()
	pendingLaunches["clearuser"] = PendingLaunch{GuideID: "prometheus-grafana-101", RequestedAt: time.Now()}
	pendingLaunchesMu.Unlock()

	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodPost, "/mcp/pending-launch/clear", bytes.NewReader(nil))
	req.Header.Set("X-Grafana-User", "clearuser")
	rr := httptest.NewRecorder()
	app.handlePendingLaunch(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	pendingLaunchesMu.Lock()
	_, stillPresent := pendingLaunches["clearuser"]
	pendingLaunchesMu.Unlock()
	if stillPresent {
		t.Error("pending launch should have been cleared")
	}
}
