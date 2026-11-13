package publiccontent

import (
	"encoding/json"
	"net/http"
)

func serveRecommendations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, available, err := ReadRecommendations(r.Context())
	if err != nil {
		panic(err)
	}
	w.Header().Set("Content-Type", "application/json")
	if !available {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		panic(err)
	}
	_ = json.NewEncoder(w).Encode(value)
}
