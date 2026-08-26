package plugin

import (
	"encoding/json"
	"net/http"
)

// registerRoutes sets up the HTTP routes for the plugin. Every route is a read
// proxy for the App Platform aggregator or the recommender CDN — see
// docs/design/BACKEND_PROXY_PATTERN.md.
func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/package-recommendations", a.handlePackageRecommendations)
	mux.HandleFunc("/completion-records", a.handleCreateCompletionRecord)
	mux.HandleFunc("/completion-records/my", a.handleMyCompletions)
	mux.HandleFunc("/completion-records/capability", a.handleCompletionCapability)
	mux.HandleFunc("/custom-guide-repository", a.handleCustomGuideRepository)
	mux.HandleFunc("/health", a.handleHealth)
}

// handleHealth returns the plugin health status.
func (a *App) handleHealth(w http.ResponseWriter, _ *http.Request) {
	a.writeJSON(w, map[string]interface{}{"status": "ok"}, http.StatusOK)
}

// Helper functions

func (a *App) writeJSON(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		a.logger.Error("Failed to encode JSON response", "error", err)
	}
}

func (a *App) writeError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
