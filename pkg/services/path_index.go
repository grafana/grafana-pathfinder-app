package services

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/src/learning-paths"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

func ResolveGuidesFromPathIndex(ctx context.Context, pathURL string, client *http.Client) ([]string, error) {
	if !strings.HasSuffix(pathURL, "/") {
		pathURL += "/"
	}
	endpoint, err := url.Parse(pathURL)
	if err != nil {
		return nil, err
	}
	if endpoint.Scheme != "https" || endpoint.Host == "" {
		return nil, fmt.Errorf("path index url must be https")
	}
	endpoint.Path += "index.json"
	endpoint.RawQuery = ""
	endpoint.Fragment = ""

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	var items []struct {
		Relpermalink string `json:"relpermalink"`
		Params       struct {
			Grafana struct {
				Skip bool `json:"skip"`
			} `json:"grafana"`
		} `json:"params"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.Params.Grafana.Skip {
			continue
		}
		if slug := lastPathSegment(item.Relpermalink); slug != "" {
			ids = append(ids, slug)
		}
	}
	return ids, nil
}

func lastPathSegment(p string) string {
	trimmed := strings.Trim(p, "/")
	return trimmed[strings.LastIndex(trimmed, "/")+1:]
}

var localCatalogue = sync.OnceValues(func() ([]BundledPath, error) {
	paths := []BundledPath{}
	seen := map[string]bool{}
	for _, data := range [][]byte{learningpaths.PathsCloudJSON, learningpaths.PathsOSSJSON} {
		var file struct {
			Paths []BundledPath `json:"paths"`
		}
		if err := json.Unmarshal(data, &file); err != nil {
			return nil, err
		}
		for _, path := range file.Paths {
			if seen[path.ID] {
				return nil, fmt.Errorf("duplicate bundled path ID %q", path.ID)
			}
			seen[path.ID] = true
			paths = append(paths, path)
		}
	}
	return paths, nil
})

func LoadLocalCatalogue() ([]BundledPath, error) { return localCatalogue() }
