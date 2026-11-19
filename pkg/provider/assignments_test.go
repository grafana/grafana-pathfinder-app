package provider

import (
	"context"
	"encoding/json"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type assignmentReaderFunc func(context.Context, string, string) (*services.AssignmentPage, error)

func (f assignmentReaderFunc) ListPage(ctx context.Context, namespace, token string) (*services.AssignmentPage, error) {
	return f(ctx, namespace, token)
}

func TestAssignmentsSDKIdentityProgressAndRepair(t *testing.T) {
	reads, repairs := 0, 0
	deps := assignmentRouteDependencies{
		Assignments: assignmentReaderFunc(func(ctx context.Context, ns, token string) (*services.AssignmentPage, error) {
			reads++
			if ns != "default" {
				t.Fatalf("wrong namespace %s", ns)
			}
			return &services.AssignmentPage{Records: []services.Assignment{
				{Name: "mine", UserID: "user:a", Lifecycle: "active", TargetType: "guide", TargetID: "guide", TargetSource: "app-platform"},
				{Name: "other", UserID: "user:b", Lifecycle: "active", TargetType: "guide", TargetID: "private", TargetSource: "app-platform"},
			}}, nil
		}),
		ReadCompletions: func(ctx context.Context, ns, subject string) ([]services.CompletionRecord, error) {
			if ns != "default" || subject != "user:a" {
				t.Fatal("untrusted identity")
			}
			return []services.CompletionRecord{{GuideID: "guide", GuideSource: "app-platform", CompletionPercent: 100, CompletedAt: "2026-11-13T00:00:00Z"}}, nil
		},
		Evaluator: func(ctx context.Context, ns string) *services.ObligationEvaluator {
			return &services.ObligationEvaluator{Context: ctx, Logger: log.DefaultLogger}
		},
		MarkSatisfied: func(ctx context.Context, ns string, records []services.Assignment) {
			repairs++
			if ns != "default" || len(records) != 1 || records[0].Name != "mine" {
				t.Fatalf("wrong repairs: %+v", records)
			}
		},
		Allow: func(ns, subject string) (bool, time.Duration) { return true, 0 },
	}
	handler := assignmentsReadHandler(deps)
	ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:a"})
	w := httptest.NewRecorder()
	if err := handler(ctx, w, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	var response assignmentResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Capability.Available || response.UserID != "user:a" || len(response.Assignments) != 1 || !response.Assignments[0].Satisfied || repairs != 1 {
		t.Fatalf("incorrect response: %s repairs=%d", w.Body.String(), repairs)
	}
	for _, testCtx := range []context.Context{context.Background(), authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "other"}, subject: "user:a"})} {
		w := httptest.NewRecorder()
		if err := handler(testCtx, w, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Capability.Available || response.Capability.Reason != "identity-unavailable" {
			t.Fatalf("identity accepted: %s", w.Body.String())
		}
	}
	if reads != 1 || repairs != 1 {
		t.Fatal("unauthorized resource access")
	}
}

func TestAssignmentFailureAndAdmissionAvoidDependentReads(t *testing.T) {
	ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity{namespace: "default"}, "user:mine"})
	for _, tc := range []struct {
		method           string
		allowed          bool
		upstream, status int
		retry            string
		reads            int
	}{
		{"POST", true, 0, 405, "", 0}, {"GET", false, 0, 429, "2", 0}, {"GET", true, 403, 200, "", 1}, {"GET", true, 503, 503, "30", 1}, {"GET", true, 200, 200, "", 1},
	} {
		reads := 0
		deps := assignmentRouteDependencies{
			Allow: func(string, string) (bool, time.Duration) { return tc.allowed, 1500 * time.Millisecond },
			Assignments: assignmentReaderFunc(func(context.Context, string, string) (*services.AssignmentPage, error) {
				reads++
				if tc.upstream != 200 {
					return nil, &apierrors.StatusError{ErrStatus: metav1.Status{Code: int32(tc.upstream)}}
				}
				return &services.AssignmentPage{}, nil
			}),
			Evaluator: func(ctx context.Context, _ string) *services.ObligationEvaluator {
				return &services.ObligationEvaluator{Context: ctx}
			},
		}
		w := httptest.NewRecorder()
		err := assignmentsReadHandler(deps)(ctx, w, &app.CustomRouteRequest{Method: tc.method, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
		require.NoError(t, err)
		require.Equal(t, tc.status, w.Code)
		require.Equal(t, tc.retry, w.Header().Get("Retry-After"))
		require.Equal(t, tc.reads, reads)
		if tc.upstream == 403 {
			require.Contains(t, w.Body.String(), "upstream-403")
		}
	}
}
