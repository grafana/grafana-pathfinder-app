package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestResourceWritePreservesUpstreamValidation(t *testing.T) {
	upstream := metav1.Status{Status: "Failure", Code: 422, Reason: metav1.StatusReasonInvalid, Message: "spec.title is required", Details: &metav1.StatusDetails{Causes: []metav1.StatusCause{{Field: "spec.title", Type: metav1.CauseTypeFieldValueRequired}}}}
	called := false
	handler := resourceWriteHandler("InteractiveGuide", 4096, func(ctx context.Context, namespace string, _ json.RawMessage, create bool) (json.RawMessage, error) {
		called = true
		identity, ok := authlib.AuthInfoFrom(ctx)
		if !ok || identity.GetNamespace() != "default" || namespace != "default" || !create {
			t.Fatal("write lost caller context or namespace")
		}
		return nil, &apierrors.StatusError{ErrStatus: upstream}
	}, nil)
	ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
	request := func(namespace string) *app.CustomRouteRequest {
		return &app.CustomRouteRequest{Method: http.MethodPost, ResourceIdentifier: resource.FullIdentifier{Namespace: namespace}, Body: io.NopCloser(strings.NewReader(`{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"InteractiveGuide","metadata":{"name":"guide","namespace":"default"},"spec":{}}`))}
	}
	recorder := httptest.NewRecorder()
	if err := handler(ctx, recorder, request("default")); err != nil {
		t.Fatal(err)
	}
	var response metav1.Status
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !called || recorder.Code != 422 || response.Message != upstream.Message || response.Details.Causes[0].Field != "spec.title" {
		t.Fatalf("validation contract changed: %s", recorder.Body.String())
	}
	called = false
	recorder = httptest.NewRecorder()
	if err := handler(ctx, recorder, request("org-2")); err != nil {
		t.Fatal(err)
	}
	if called || recorder.Code != http.StatusForbidden {
		t.Fatal("cross-namespace request reached resource writer")
	}
}
