package resourceaccess

import (
	"context"
	"encoding/json"
	authlib "github.com/grafana/authlib/types"
	"net/http"
	"net/http/httptest"
	"testing"

	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

func TestAssignmentStoreFiltersEveryPageAndPreservesStatusVersion(t *testing.T) {
	pages, writes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPut {
			writes++
			if r.URL.Path != "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/assignments/mine/status" {
				t.Errorf("status path: %s", r.URL.Path)
			}
			var body struct {
				Metadata struct {
					ResourceVersion string `json:"resourceVersion"`
				} `json:"metadata"`
				Status struct {
					Satisfied *bool `json:"satisfied"`
				} `json:"status"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.Metadata.ResourceVersion != "42" || body.Status.Satisfied == nil || !*body.Status.Satisfied {
				t.Errorf("lost version or status: %+v", body)
			}
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"kind":"Status","status":"Failure","reason":"Conflict","code":409}`))
			return
		}
		pages++
		if r.URL.Query().Get("limit") != "500" {
			t.Error("wrong page limit")
		}
		if pages == 1 {
			_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[{"metadata":{"name":"other"},"spec":{"userId":"other","lifecycle":"active"}},{"metadata":{"name":"withdrawn"},"spec":{"userId":"caller","lifecycle":"withdrawn"}}]}`))
		} else {
			if r.URL.Query().Get("continue") != "next" {
				t.Error("missing continuation")
			}
			_, _ = w.Write([]byte(`{"metadata":{},"items":[{"metadata":{"name":"mine","resourceVersion":"42"},"spec":{"userId":"caller","lifecycle":"active","targetId":"guide"},"status":{"satisfied":false}},{"metadata":{"name":"unevaluated"},"spec":{"userId":"caller","lifecycle":"active"}}]}`))
		}
	}))
	defer server.Close()
	store, err := NewAssignmentStore(sdkplugin.BuildClientGenerator(BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, GuidePageMaxBytes)))
	if err != nil {
		t.Fatal(err)
	}
	records, err := services.ReadAssignments(context.Background(), "default", "caller", store)
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 || len(records) != 2 {
		t.Fatalf("pages=%d records=%+v", pages, records)
	}
	if records[0].Name != "mine" || records[0].ResourceVersion != "42" || records[0].StatusSatisfied == nil || *records[0].StatusSatisfied || records[1].StatusSatisfied != nil {
		t.Fatalf("lost assignment metadata/status: %+v", records)
	}
	if err := store.UpdateStatus(context.Background(), "default", records[0].Name, records[0].ResourceVersion, true); err == nil {
		t.Fatal("conflict swallowed")
	}
	if writes != 1 {
		t.Fatalf("unexpected status retries: %d", writes)
	}
}

type statusRepairIdentity struct {
	authlib.AuthInfo
	namespace, subject string
}

func (i statusRepairIdentity) GetNamespace() string { return i.namespace }
func (i statusRepairIdentity) GetSubject() string   { return i.subject }

func TestAssignmentStatusRepairRejectsUnboundRecords(t *testing.T) {
	store := &AssignmentStore{}
	record := services.Assignment{Name: "assignment", ResourceVersion: "42", UserID: "user:1"}
	for _, tc := range []struct {
		name, namespace, subject string
		anonymous                bool
	}{
		{"missing identity", "default", "user:1", true},
		{"other namespace", "org-2", "user:1", false},
		{"other subject", "default", "user:2", false},
		{"wildcard", "*", "user:1", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if !tc.anonymous {
				ctx = authlib.WithAuthInfo(ctx, statusRepairIdentity{namespace: tc.namespace, subject: tc.subject})
			}
			if err := store.MarkSatisfied(ctx, "default", record); err == nil {
				t.Fatal("unbound repair accepted")
			}
		})
	}
	ctx := authlib.WithAuthInfo(context.Background(), statusRepairIdentity{namespace: "default", subject: "user:1"})
	record.ResourceVersion = ""
	if err := store.MarkSatisfied(ctx, "default", record); err == nil {
		t.Fatal("versionless repair accepted")
	}
}
