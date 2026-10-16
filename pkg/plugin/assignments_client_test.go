package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestAssignmentHTTPClient_ListPageDecodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/apis/"+assignmentsGroupVersion+"/namespaces/stacks-1/assignments" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("continue"); got != "tok-1" {
			t.Errorf("continue = %q, want tok-1", got)
		}
		_, _ = w.Write([]byte(`{
			"metadata": {"continue": "tok-2"},
			"items": [
				{"metadata": {"name": "a-1", "resourceVersion": "7"},
				 "spec": {"userId": "user:1", "targetType": "path", "targetId": "p", "lifecycle": "active"},
				 "status": {"satisfied": true}},
				{"metadata": {"name": "a-2", "resourceVersion": "8"},
				 "spec": {"userId": "user:2", "targetType": "path", "targetId": "q", "lifecycle": "active"}}
			]
		}`))
	}))
	defer srv.Close()

	client := newAssignmentHTTPClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token", log.DefaultLogger)
	page, err := client.ListPage(context.Background(), "stacks-1", "tok-1")
	if err != nil {
		t.Fatalf("ListPage: %v", err)
	}

	yes := true
	want := []assignmentSpec{
		{Name: "a-1", ResourceVersion: "7", StatusSatisfied: &yes, UserID: "user:1", TargetType: "path", TargetID: "p", Lifecycle: "active"},
		{Name: "a-2", ResourceVersion: "8", UserID: "user:2", TargetType: "path", TargetID: "q", Lifecycle: "active"},
	}
	if !reflect.DeepEqual(page.Records, want) {
		t.Errorf("records = %+v, want %+v", page.Records, want)
	}
	if page.Continue != "tok-2" {
		t.Errorf("continue = %q, want tok-2", page.Continue)
	}
}

func TestAssignmentHTTPClient_UpdateStatus(t *testing.T) {
	t.Run("PUTs the status document", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPut || r.URL.Path != "/apis/"+assignmentsGroupVersion+"/namespaces/stacks-1/assignments/a-1/status" {
				t.Errorf("request = %s %s", r.Method, r.URL.Path)
			}
			body, _ := io.ReadAll(r.Body)
			var got map[string]any
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			want := map[string]any{
				"apiVersion": assignmentsGroupVersion,
				"kind":       "Assignment",
				"metadata":   map[string]any{"name": "a-1", "namespace": "stacks-1", "resourceVersion": "42"},
				"status":     map[string]any{"satisfied": true},
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("body = %v, want %v", got, want)
			}
			_, _ = w.Write([]byte(`{}`))
		}))
		defer srv.Close()

		client := newAssignmentHTTPClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token", log.DefaultLogger)
		if err := client.UpdateStatus(context.Background(), "stacks-1", "a-1", "42", true); err != nil {
			t.Fatalf("UpdateStatus: %v", err)
		}
	})
}
