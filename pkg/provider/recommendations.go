package provider

import (
	"context"
	"encoding/json"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
)

func recommendationsHandler(read services.RecommendationsReader) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		if req.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		body, available, err := read(ctx)
		if err != nil {
			return err
		}
		if !available {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_, err = w.Write(body)
		return err
	}
}
func healthHandler(_ context.Context, w app.CustomRouteResponseWriter, _ *app.CustomRouteRequest) error {
	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
