package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/logging"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

type guideListResponse struct {
	Items []json.RawMessage `json:"items"`
}

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

func guidesReadHandler(store *resourceaccess.GuideStore) simple.AppCustomRouteHandler {
	return resourceReadHandler("interactiveguides", "list", func(ctx context.Context, namespace string, _ *app.CustomRouteRequest) (json.RawMessage, error) {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		items, err := services.ReadGuideResources(ctx, namespace, 32*1024*1024, 50000, store.ListPage, func(items int, bytes int64) {
			logging.DefaultLogger.Warn("custom guides: list truncated", "namespace", namespace, "items", items, "bytes", bytes, "maxBytes", 32*1024*1024)
		})
		if err != nil {
			return nil, err
		}
		return json.Marshal(guideListResponse{Items: items})
	})
}
