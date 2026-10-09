package plugin

import (
	"context"
	"encoding/json"
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
	items := make([]json.RawMessage, 0)
	totalBytes := int64(len(`{"items":[]}`))
	continueToken := ""
	for {
		page, err := c.listRawPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			itemBytes := int64(len(item))
			if len(items) > 0 {
				itemBytes++
			}
			if totalBytes+itemBytes > maxBytes || len(items) >= customGuideListMaxTotalEntries {
				c.logger.Warn("custom guides: list truncated", "namespace", namespace, "items", len(items), "bytes", totalBytes, "maxBytes", maxBytes)
				return items, nil
			}
			items = append(items, item)
			totalBytes += itemBytes
		}
		continueToken = page.Metadata.Continue
		if continueToken == "" {
			return items, nil
		}
	}
}
