package plugin

import (
	"context"
	"encoding/json"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"time"
)

const (
	// Full resources include blocks; 100 typical 40 KB guides fit the 8 MiB page cap.
	customGuidesPageSize = 100
	customGuidesMaxBytes = 32 * 1024 * 1024
	customGuidesDeadline = 30 * time.Second
)

type customGuidesResponse struct {
	Items []json.RawMessage `json:"items"`
}

func (a *App) handleCustomGuides(w http.ResponseWriter, r *http.Request) {
	client, namespace := a.appPlatformReadClient(w, r, customGuideResource, "list")
	if client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), customGuidesDeadline)
	defer cancel()
	items, err := client.drainGuideResources(ctx, namespace, customGuidesMaxBytes)
	if err != nil {
		a.writeProxyError(w, "app platform read failed", appPlatformReadErrorStatus(err), appPlatformDiagnostic(err, customGuideResource, "list"))
		return
	}
	a.writeJSON(w, customGuidesResponse{Items: items}, http.StatusOK)
}

func (c *appPlatformListClient) drainGuideResources(ctx context.Context, namespace string, maxBytes int64) ([]json.RawMessage, error) {
	return services.ReadGuideResources(ctx, namespace, maxBytes, customGuideListMaxTotalEntries,
		func(ctx context.Context, namespace, token string) (services.GuidePage, error) {
			page, err := c.listRawPage(ctx, namespace, token)
			if err != nil {
				return services.GuidePage{}, err
			}
			return services.GuidePage{Items: page.Items, Continue: page.Metadata.Continue}, nil
		}, func(items int, bytes int64) {
			c.logger.Warn("custom guides: list truncated", "namespace", namespace, "items", items, "bytes", bytes, "maxBytes", maxBytes)
		})
}
