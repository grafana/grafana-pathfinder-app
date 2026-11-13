package plugin

import (
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
)

func (a *App) handleCustomGuide(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if !services.ValidGuideName(name) {
		a.writeError(w, "invalid guide name", http.StatusBadRequest)
		return
	}
	a.handleAppPlatformRead(w, r, "interactiveguides", name, customGuideListMaxBytes)
}
