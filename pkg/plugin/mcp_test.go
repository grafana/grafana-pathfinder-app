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
// tools/list
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
	if len(tools) == 0 {
		t.Error("expected at least one tool in tools/list response")
	}
	// All expected tool names should be present
	expected := map[string]bool{
		"list_guides": false, "get_guide": false, "get_guide_schema": false,
		"launch_guide": false, "validate_guide_json": false, "create_guide_template": false,
	}
	for _, raw := range tools {
		tool := raw.(map[string]interface{})
		name := tool["name"].(string)
		expected[name] = true
	}
	for name, found := range expected {
		if !found {
			t.Errorf("tool %q missing from tools/list", name)
		}
	}
}

// ---------------------------------------------------------------------------
// list_guides
// ---------------------------------------------------------------------------

func TestToolListGuides_ReturnsAll(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "list_guides", map[string]interface{}{})
	data := extractToolData(t, out)
	guides := data["guides"].([]interface{})
	if len(guides) == 0 {
		t.Error("expected at least one guide")
	}
	total := data["total"].(float64)
	if int(total) != len(guides) {
		t.Errorf("total %d does not match guides length %d", int(total), len(guides))
	}
}

func TestToolListGuides_FilterByCategory(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "list_guides", map[string]interface{}{"category": "getting-started"})
	data := extractToolData(t, out)
	guides := data["guides"].([]interface{})
	for _, raw := range guides {
		g := raw.(map[string]interface{})
		if g["category"] != "getting-started" {
			t.Errorf("guide %q has category %q, expected 'getting-started'", g["id"], g["category"])
		}
	}
}

func TestToolListGuides_FilterNoMatch_ReturnsEmptyArray(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "list_guides", map[string]interface{}{"category": "nonexistent-category-xyz"})
	data := extractToolData(t, out)
	// Must be [] not null
	raw, err := json.Marshal(data["guides"])
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "null" {
		t.Error("guides should be [] not null when no results match")
	}
	if string(raw) != "[]" {
		t.Errorf("expected empty array [], got %s", raw)
	}
}

// ---------------------------------------------------------------------------
// get_guide
// ---------------------------------------------------------------------------

func TestToolGetGuide_ValidID(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "get_guide", map[string]interface{}{"id": "first-dashboard"})
	if isToolError(out) {
		t.Fatalf("unexpected error: %v", out)
	}
	data := extractToolData(t, out)
	if data["id"] != "first-dashboard" {
		t.Errorf("expected id 'first-dashboard', got %v", data["id"])
	}
	if data["content"] == nil {
		t.Error("expected content field in result")
	}
}

func TestToolGetGuide_MissingID(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "get_guide", map[string]interface{}{})
	if !isToolError(out) {
		t.Error("expected error for missing id")
	}
}

func TestToolGetGuide_UnknownID(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "get_guide", map[string]interface{}{"id": "does-not-exist"})
	if !isToolError(out) {
		t.Error("expected error for unknown guide ID")
	}
}

func TestToolGetGuide_PathTraversal(t *testing.T) {
	app := newTestApp(t)
	cases := []string{"../etc/passwd", "../../secrets", "a/b", "a.b", "A_B"}
	for _, id := range cases {
		out := mcpToolCall(t, app, "get_guide", map[string]interface{}{"id": id})
		if !isToolError(out) {
			t.Errorf("expected error for potentially unsafe ID %q", id)
		}
	}
}

// ---------------------------------------------------------------------------
// get_guide_schema
// ---------------------------------------------------------------------------

func TestToolGetGuideSchema_Content(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "get_guide_schema", map[string]interface{}{"name": "content"})
	if isToolError(out) {
		t.Fatalf("unexpected error: %v", out)
	}
	data := extractToolData(t, out)
	schema := data["schema"].(map[string]interface{})
	if schema["type"] != "object" {
		t.Error("expected schema type to be 'object'")
	}
}

func TestToolGetGuideSchema_UnknownName(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "get_guide_schema", map[string]interface{}{"name": "nonexistent"})
	if !isToolError(out) {
		t.Error("expected error for unknown schema name")
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

// ---------------------------------------------------------------------------
// validate_guide_json
// ---------------------------------------------------------------------------

func TestToolValidateGuideJSON_ValidGuide(t *testing.T) {
	app := newTestApp(t)
	validGuide := `{
		"schemaVersion": "1.0.0",
		"id": "test-guide",
		"title": "Test Guide",
		"blocks": [
			{"type": "markdown", "content": "Hello"},
			{"type": "html", "content": "<p>Hi</p>"},
			{"type": "section", "id": "s1", "title": "Section", "blocks": []},
			{"type": "interactive", "action": "highlight", "reftarget": "button"}
		]
	}`
	out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": validGuide})
	if isToolError(out) {
		t.Fatalf("unexpected error: %v", out)
	}
	data := extractToolData(t, out)
	if data["isValid"] != true {
		errs, _ := json.Marshal(data["errors"])
		t.Errorf("expected isValid=true, got false, errors: %s", errs)
	}
}

func TestToolValidateGuideJSON_MissingRequiredFields(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": `{"id":"test"}`})
	data := extractToolData(t, out)
	if data["isValid"] != false {
		t.Error("expected isValid=false for guide missing title and blocks")
	}
	errs := data["errors"].([]interface{})
	if len(errs) == 0 {
		t.Error("expected at least one error")
	}
}

func TestToolValidateGuideJSON_InvalidBlockType(t *testing.T) {
	app := newTestApp(t)
	guide := `{
		"schemaVersion": "1.0.0",
		"id": "test",
		"title": "Test",
		"blocks": [{"type": "callout"}]
	}`
	out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": guide})
	data := extractToolData(t, out)
	if data["isValid"] != false {
		t.Error("expected isValid=false for unknown block type 'callout'")
	}
}

func TestToolValidateGuideJSON_AllValidBlockTypes(t *testing.T) {
	app := newTestApp(t)
	// All 14 canonical block types must pass validation
	blockTypes := []string{
		"markdown", "html", "section", "conditional", "interactive",
		"multistep", "guided", "image", "video", "quiz", "assistant",
		"input", "terminal", "grot-guide",
	}
	for _, bt := range blockTypes {
		guide := `{"schemaVersion":"1.0.0","id":"t","title":"T","blocks":[{"type":"` + bt + `"}]}`
		out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": guide})
		data := extractToolData(t, out)
		errs := data["errors"].([]interface{})
		// Filter to only block-type errors (there may be other validation errors for missing fields)
		for _, e := range errs {
			errMap := e.(map[string]interface{})
			if strings.Contains(errMap["message"].(string), "unknown block type") {
				t.Errorf("block type %q should be valid but got error: %v", bt, errMap["message"])
			}
		}
	}
}

func TestToolValidateGuideJSON_InvalidJSON(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": "not json {"})
	data := extractToolData(t, out)
	if data["isValid"] != false {
		t.Error("expected isValid=false for invalid JSON input")
	}
}

func TestToolValidateGuideJSON_FutureSemver(t *testing.T) {
	app := newTestApp(t)
	guide := `{"schemaVersion":"2.0.0","id":"t","title":"T","blocks":[]}`
	out := mcpToolCall(t, app, "validate_guide_json", map[string]interface{}{"content": guide})
	data := extractToolData(t, out)
	// Future semver should be valid (not cause an error)
	errs := data["errors"].([]interface{})
	for _, e := range errs {
		errMap := e.(map[string]interface{})
		if strings.Contains(errMap["path"].(string), "schemaVersion") {
			t.Errorf("future semver '2.0.0' should not produce a schemaVersion error: %v", errMap["message"])
		}
	}
}

// ---------------------------------------------------------------------------
// create_guide_template
// ---------------------------------------------------------------------------

func TestToolCreateGuideTemplate_Basic(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "create_guide_template", map[string]interface{}{
		"id":    "my-new-guide",
		"title": "My New Guide",
	})
	if isToolError(out) {
		t.Fatalf("unexpected error: %v", out)
	}
	data := extractToolData(t, out)

	contentJSON, ok := data["contentJson"].(string)
	if !ok || contentJSON == "" {
		t.Error("expected non-empty contentJson")
	}
	manifestJSON, ok := data["manifestJson"].(string)
	if !ok || manifestJSON == "" {
		t.Error("expected non-empty manifestJson")
	}

	// Content should be parseable and have correct ID/title
	var content map[string]interface{}
	if err := json.Unmarshal([]byte(contentJSON), &content); err != nil {
		t.Fatalf("contentJson is not valid JSON: %v", err)
	}
	if content["id"] != "my-new-guide" {
		t.Errorf("expected content id 'my-new-guide', got %v", content["id"])
	}
	if content["title"] != "My New Guide" {
		t.Errorf("expected content title 'My New Guide', got %v", content["title"])
	}
}

func TestToolCreateGuideTemplate_DefaultCategory(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "create_guide_template", map[string]interface{}{
		"id":    "guide-with-default-cat",
		"title": "Guide",
	})
	data := extractToolData(t, out)
	var manifest map[string]interface{}
	if err := json.Unmarshal([]byte(data["manifestJson"].(string)), &manifest); err != nil {
		t.Fatalf("manifestJson is not valid JSON: %v", err)
	}
	if manifest["category"] != "getting-started" {
		t.Errorf("expected default category 'getting-started', got %v", manifest["category"])
	}
}

func TestToolCreateGuideTemplate_MissingRequired(t *testing.T) {
	app := newTestApp(t)
	out := mcpToolCall(t, app, "create_guide_template", map[string]interface{}{"id": "only-id"})
	if !isToolError(out) {
		t.Error("expected error when title is missing")
	}
}
