package provider

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/grafana/grafana-app-sdk/k8s"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestUpstreamDiagnosticPreservesWrappedCause(t *testing.T) {
	var value any
	malformed := json.Unmarshal([]byte("not-json"), &value)
	for _, tc := range []struct {
		name   string
		err    error
		reason string
		status int
	}{
		{"transport deadline", k8s.NewServerResponseError(context.DeadlineExceeded, 503), "timeout", 0},
		{"cancelled", k8s.NewServerResponseError(context.Canceled, 503), "cancelled", 0},
		{"invalid json", malformed, "invalid-json", 0},
		{"actual upstream 503", &apierrors.StatusError{ErrStatus: metav1.Status{Code: 503}}, "http-error", 503},
		{"denied", &apierrors.StatusError{ErrStatus: metav1.Status{Code: 403}}, "authorization-denied", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			diagnostic := upstreamDiagnostic(tc.err, "completionrecords", "list")
			if diagnostic.Reason != tc.reason || diagnostic.UpstreamStatus != tc.status {
				t.Fatalf("unexpected diagnostic: %+v", diagnostic)
			}
		})
	}
	if upstreamDiagnostic(nil, "completionrecords", "list") != nil {
		t.Fatal("success has a diagnostic")
	}
}
