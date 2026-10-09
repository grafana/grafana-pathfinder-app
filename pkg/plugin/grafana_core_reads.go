package plugin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"unicode/utf8"
)

const (
	iamGroupVersion             = "iam.grafana.app/v0alpha1"
	dashboardGroupVersion       = "dashboard.grafana.app/v1beta1"
	dashboardSearchGroupVersion = "dashboard.grafana.app/v0alpha1"
	folderGroupVersion          = "folder.grafana.app/v1beta1"

	grafanaUserMaxBytes            = 256 * 1024
	grafanaDashboardMaxBytes       = 16 * 1024 * 1024
	grafanaFolderMaxBytes          = 256 * 1024
	grafanaDashboardSearchMaxBytes = 4 * 1024 * 1024

	grafanaDashboardUIDMaxLen      = 253
	grafanaDashboardSearchQueryMax = 256
	grafanaDashboardSearchLimit    = 100

	dashboardFolderAnnotation = "grafana.app/folder"
)

var grafanaDashboardUIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

type grafanaDashboardResponse struct {
	UID         string   `json:"uid"`
	Title       string   `json:"title"`
	Tags        []string `json:"tags"`
	FolderUID   string   `json:"folderUid"`
	FolderTitle string   `json:"folderTitle"`
}

type grafanaDashboardSearchHit struct {
	UID       string   `json:"uid"`
	Title     string   `json:"title"`
	FolderUID string   `json:"folderUid"`
	Tags      []string `json:"tags"`
}

type grafanaDashboardSearchResponse struct {
	Hits []grafanaDashboardSearchHit `json:"hits"`
}

// These routes serve the caller's own RBAC view, so nothing here may be cached.

func (a *App) handleGrafanaUser(w http.ResponseWriter, r *http.Request) {
	client, namespace, ok := a.appPlatformReadClient(w, r, "users")
	if !ok {
		return
	}
	body, err := client.getPath(r.Context(), iamGroupVersion, namespace, "users", "~", nil, grafanaUserMaxBytes)
	if err != nil {
		a.writeCoreReadError(w, err, "users")
		return
	}
	a.writeJSON(w, body, http.StatusOK)
}

func (a *App) handleGrafanaDashboard(w http.ResponseWriter, r *http.Request) {
	client, namespace, ok := a.appPlatformReadClient(w, r, "dashboards")
	if !ok {
		return
	}
	uid := r.URL.Query().Get("uid")
	if !validDashboardUID(uid) {
		a.writeError(w, "invalid dashboard uid", http.StatusBadRequest)
		return
	}
	body, err := client.getPath(r.Context(), dashboardGroupVersion, namespace, "dashboards", uid, nil, grafanaDashboardMaxBytes)
	if err != nil {
		a.writeCoreReadError(w, err, "dashboards")
		return
	}
	var dashboard struct {
		Metadata struct {
			Name        string            `json:"name"`
			Annotations map[string]string `json:"annotations"`
		} `json:"metadata"`
		Spec struct {
			Title string   `json:"title"`
			Tags  []string `json:"tags"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(body, &dashboard); err != nil {
		a.writeCoreReadError(w, invalidCoreReadJSON(err), "dashboards")
		return
	}
	resp := grafanaDashboardResponse{
		UID:       dashboard.Metadata.Name,
		Title:     dashboard.Spec.Title,
		Tags:      nonNilStrings(dashboard.Spec.Tags),
		FolderUID: dashboard.Metadata.Annotations[dashboardFolderAnnotation],
	}
	if resp.FolderUID != "" {
		resp.FolderTitle = a.folderTitle(r, client, namespace, resp.FolderUID)
	}
	a.writeJSON(w, resp, http.StatusOK)
}

func (a *App) folderTitle(r *http.Request, client *appPlatformListClient, namespace, folderUID string) string {
	body, err := client.fetchPath(r.Context(), folderGroupVersion, namespace, "folders", folderUID, nil, grafanaFolderMaxBytes)
	if err != nil {
		a.ctxLogger(r.Context()).Debug("dashboard folder title unavailable", "error", err)
		return ""
	}
	var folder struct {
		Spec struct {
			Title string `json:"title"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(body, &folder); err != nil {
		a.ctxLogger(r.Context()).Debug("dashboard folder title unavailable", "error", err)
		return ""
	}
	return folder.Spec.Title
}

func (a *App) handleGrafanaDashboardSearch(w http.ResponseWriter, r *http.Request) {
	client, namespace, ok := a.appPlatformReadClient(w, r, "search")
	if !ok {
		return
	}
	query := r.URL.Query().Get("query")
	if utf8.RuneCountInString(query) > grafanaDashboardSearchQueryMax {
		a.writeError(w, "invalid dashboard search query", http.StatusBadRequest)
		return
	}
	params := url.Values{}
	params.Set("type", "dashboard")
	params.Set("limit", strconv.Itoa(grafanaDashboardSearchLimit))
	if query != "" {
		params.Set("query", query)
	}
	body, err := client.getPath(r.Context(), dashboardSearchGroupVersion, namespace, "search", "", params, grafanaDashboardSearchMaxBytes)
	if err != nil {
		a.writeCoreReadError(w, err, "search")
		return
	}
	var result struct {
		Hits []struct {
			Name   string   `json:"name"`
			Title  string   `json:"title"`
			Folder string   `json:"folder"`
			Tags   []string `json:"tags"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		a.writeCoreReadError(w, invalidCoreReadJSON(err), "search")
		return
	}
	resp := grafanaDashboardSearchResponse{Hits: make([]grafanaDashboardSearchHit, 0, len(result.Hits))}
	for _, hit := range result.Hits {
		resp.Hits = append(resp.Hits, grafanaDashboardSearchHit{
			UID:       hit.Name,
			Title:     hit.Title,
			FolderUID: hit.Folder,
			Tags:      nonNilStrings(hit.Tags),
		})
	}
	a.writeJSON(w, resp, http.StatusOK)
}

func validDashboardUID(uid string) bool {
	return len(uid) <= grafanaDashboardUIDMaxLen && uid != "." && uid != ".." && grafanaDashboardUIDPattern.MatchString(uid)
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func invalidCoreReadJSON(err error) error {
	return &guideProxyError{diagnostic: guideProxyDiagnostic{Outcome: "error", Reason: "invalid-json"}, err: fmt.Errorf("decode app platform response: %w", err)}
}

func (a *App) writeCoreReadError(w http.ResponseWriter, err error, resource string) {
	a.writeProxyError(w, "app platform read failed", appPlatformReadErrorStatus(err), appPlatformDiagnostic(err, resource, "get"))
}
