package plugin

import (
	"net/http"
	"strings"
	"unicode"
)

func (a *App) handleCustomGuide(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\%") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		a.writeError(w, "invalid guide name", http.StatusBadRequest)
		return
	}
	a.handleAppPlatformRead(w, r, "interactiveguides", name, customGuideListMaxBytes)
}
