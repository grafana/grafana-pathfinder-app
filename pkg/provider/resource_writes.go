package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type resourceWriter func(context.Context, string, json.RawMessage, bool) (json.RawMessage, error)

func resourceWriteHandler(kind string, maxBytes int64, write resourceWriter, remove func(context.Context, string, string) error) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(status int, message string) error {
			w.WriteHeader(status)
			return json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if req.Method != http.MethodPost && req.Method != http.MethodPut && (req.Method != http.MethodDelete || remove == nil) {
			return fail(http.StatusMethodNotAllowed, "method not allowed")
		}
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		if err != nil {
			return fail(http.StatusForbidden, "identity-unavailable")
		}
		name := ""
		if req.URL != nil {
			name = req.URL.Query().Get("name")
		}
		upstreamError := func(err error) error {
			if seconds, ok := apierrors.SuggestsClientDelay(err); ok {
				w.Header().Set("Retry-After", strconv.Itoa(seconds))
			}
			var upstream apierrors.APIStatus
			if errors.As(err, &upstream) && upstream.Status().Code >= 400 && upstream.Status().Code <= 599 {
				w.WriteHeader(int(upstream.Status().Code))
				return json.NewEncoder(w).Encode(upstream.Status())
			}
			status := sdkErrorStatus(err)
			if status < 400 || status > 599 {
				status = http.StatusBadGateway
			}
			return fail(status, "resource-write-failed")
		}
		if req.Method == http.MethodDelete {
			if !services.ValidGuideName(name) {
				return fail(http.StatusBadRequest, "invalid resource name")
			}
			if err := remove(ctx, namespace, name); err != nil {
				return upstreamError(err)
			}
			return json.NewEncoder(w).Encode(map[string]string{"status": "Success"})
		}
		if req.Body == nil {
			return fail(http.StatusBadRequest, "invalid request body")
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxBytes))
		if err != nil {
			return fail(http.StatusBadRequest, "invalid request body")
		}
		var object struct {
			APIVersion string `json:"apiVersion"`
			Kind       string `json:"kind"`
			Metadata   struct {
				Name            string `json:"name"`
				Namespace       string `json:"namespace"`
				ResourceVersion string `json:"resourceVersion"`
			} `json:"metadata"`
		}
		if json.Unmarshal(body, &object) != nil {
			return fail(http.StatusBadRequest, "invalid request body")
		}
		if object.APIVersion != "pathfinderbackend.ext.grafana.app/v1alpha1" || object.Kind != kind {
			return fail(http.StatusBadRequest, "invalid resource type")
		}
		if !services.ValidGuideName(object.Metadata.Name) || (name != "" && name != object.Metadata.Name) {
			return fail(http.StatusBadRequest, "resource name mismatch")
		}
		if object.Metadata.Namespace != "" && object.Metadata.Namespace != namespace {
			return fail(http.StatusForbidden, "namespace mismatch")
		}
		if kind == "PathfinderSettings" && object.Metadata.Name != "default" {
			return fail(http.StatusBadRequest, "invalid settings name")
		}
		if req.Method == http.MethodPut && object.Metadata.ResourceVersion == "" {
			return fail(http.StatusBadRequest, "resource version required")
		}
		result, err := write(ctx, namespace, body, req.Method == http.MethodPost)
		if err != nil {
			return upstreamError(err)
		}
		if req.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
		}
		_, err = w.Write(result)
		return err
	}
}
