package provider

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func guideReadHandler(store *resourceaccess.GuideStore) simple.AppCustomRouteHandler {
	read := resourceReadHandler("interactiveguides", "get", func(ctx context.Context, namespace string, request *app.CustomRouteRequest) (json.RawMessage, error) {
		ctx, cancel := context.WithTimeout(ctx, services.SettingsReadTimeout)
		defer cancel()
		return store.Read(ctx, namespace, request.URL.Query().Get("name"))
	})
	return func(ctx context.Context, w app.CustomRouteResponseWriter, request *app.CustomRouteRequest) error {
		if request.URL == nil || !services.ValidGuideName(request.URL.Query().Get("name")) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			return json.NewEncoder(w).Encode(map[string]string{"error": "invalid guide name"})
		}
		return read(ctx, w, request)
	}
}
