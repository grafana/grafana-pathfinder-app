package publiccontent

import (
	"context"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

type publicFeedInstance struct {
	backend.CallResourceHandler
}

func (publicFeedInstance) CheckHealth(context.Context, *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "ok"}, nil
}

// The public feed is available even on Grafana installations without SDK registration.
func NewPublicFeedInstance(context.Context, backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/package-recommendations", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, available, err := ReadRecommendations(r.Context())
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			http.Error(w, "could not encode package index", http.StatusInternalServerError)
			return
		}
		if !available {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_, _ = w.Write(body)
	})
	return publicFeedInstance{httpadapter.New(mux)}, nil
}
