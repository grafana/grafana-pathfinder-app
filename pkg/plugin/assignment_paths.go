package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/src/learning-paths"
)

// pathGuideSource resolves a path target to its guide ids, or to one track's
// guides when trackID is set (empty means the default milestones). found=false
// means the source does not know the target and the next one is tried;
// found=true stops resolution, with nil guides when the target could not be
// resolved. err means the source failed, which says nothing about the target.
type pathGuideSource func(ctx context.Context, targetID, trackID string) (guides []string, found bool, err error)

const pathIndexTimeout = 10 * time.Second

type bundledPath struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Guides []string `json:"guides"`
}

type bundledCatalogue struct {
	Paths []bundledPath `json:"paths"`
}

var (
	catalogueOnce sync.Once
	catalogue     []bundledPath
	catalogueErr  error

	// pathIndexFetch is overridden in tests
	pathIndexFetch = resolveGuidesFromPathIndex
)

var pathIndexClient = &http.Client{
	Timeout: pathIndexTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// bundledPathGuides resolves a target from the embedded catalogue. An entry
// with a URL and no inline guides is resolved from that docs site's index.json.
// Bundled paths declare no tracks.
func bundledPathGuides(logger log.Logger) pathGuideSource {
	return func(ctx context.Context, targetID, trackID string) ([]string, bool, error) {
		paths, err := loadLocalCatalogue()
		if err != nil {
			logger.Info("bundled path catalogue unavailable", "error", err)
			return nil, false, nil
		}
		for _, path := range paths {
			if path.ID != targetID || (len(path.Guides) == 0 && path.URL == "") {
				continue
			}
			if trackID != "" {
				return trackNotFound(logger, targetID, trackID)
			}
			if len(path.Guides) > 0 {
				return path.Guides, true, nil
			}
			guides, err := pathIndexFetch(ctx, path.URL)
			if err != nil {
				return nil, true, err
			}
			if len(guides) == 0 {
				return nil, true, nil
			}
			return guides, true, nil
		}
		return nil, false, nil
	}
}

// trackNotFound is the result for a found target that declares no such track:
// resolved, but with no guides to complete.
func trackNotFound(logger log.Logger, targetID, trackID string) ([]string, bool, error) {
	logger.Warn("assignment track not found", "targetId", targetID, "trackId", trackID)
	return nil, true, nil
}

// customPathGuides resolves a target from the namespace's published custom
// paths and journeys, keeping only guides that are themselves published. Only
// a path can declare tracks.
func customPathGuides(entries []customGuideRepositoryEntry, logger log.Logger) pathGuideSource {
	published := map[string]struct{}{}
	for i := range entries {
		if entries[i].Status == "published" {
			published[entries[i].ID] = struct{}{}
		}
	}
	return func(_ context.Context, targetID, trackID string) ([]string, bool, error) {
		for i := range entries {
			entry := &entries[i]
			if entry.ID != targetID || entry.Status != "published" || entry.Manifest == nil {
				continue
			}
			if entry.Manifest.Type != "path" && entry.Manifest.Type != "journey" {
				continue
			}
			ids := entry.Manifest.Milestones
			if trackID != "" {
				track := slices.IndexFunc(entry.Manifest.Tracks, func(t customGuideManifestTrack) bool { return t.TrackID == trackID })
				if entry.Manifest.Type != "path" || track < 0 {
					return trackNotFound(logger, targetID, trackID)
				}
				ids = entry.Manifest.Tracks[track].Guides
			}
			var guides []string
			for _, id := range ids {
				if _, ok := published[id]; ok {
					guides = append(guides, id)
				}
			}
			return guides, true, nil
		}
		return nil, false, nil
	}
}

// onlinePathGuides resolves a target from the public package index, fetching
// the manifest on demand when the index entry was not enriched with one.
func (a *App) onlinePathGuides(logger log.Logger) pathGuideSource {
	return func(ctx context.Context, targetID, trackID string) ([]string, bool, error) {
		resp, err := a.getCachedPackageRecommendations(ctx)
		if err != nil {
			return nil, false, err
		}
		for i := range resp.Packages {
			entry := &resp.Packages[i]
			if entry.ID != targetID {
				continue
			}
			manifest := entry.Manifest
			if manifest == nil {
				manifestURL := buildPackageFileURL(resp.BaseURL, entry.Path, "manifest.json")
				if manifestURL == "" || !isAllowedInteractiveLearningHost(manifestURL) {
					return nil, true, nil
				}
				fetch := packageRepositoryFetcherOverride
				if fetch == nil {
					fetch = defaultPackageRepositoryFetcher
				}
				body, fetchErr := fetch(ctx, manifestURL, packageManifestMaxBytes)
				if fetchErr != nil {
					return nil, true, fetchErr
				}
				if jsonErr := json.Unmarshal(body, &manifest); jsonErr != nil {
					return nil, true, fmt.Errorf("parse manifest: %w", jsonErr)
				}
			}
			ids, _ := manifest["milestones"].([]interface{})
			if trackID != "" {
				var ok bool
				if ids, ok = manifestTrackGuides(manifest, trackID); !ok {
					return trackNotFound(logger, targetID, trackID)
				}
			}
			return resolveGuideIDs(resp.Packages, ids), true, nil
		}
		return nil, false, nil
	}
}

// manifestTrackGuides is the guide ids of the named track in a path manifest;
// ok is false when the manifest is not a path or declares no such track.
func manifestTrackGuides(manifest map[string]interface{}, trackID string) (ids []interface{}, ok bool) {
	if manifest["type"] != "path" {
		return nil, false
	}
	tracks, _ := manifest["tracks"].([]interface{})
	for _, t := range tracks {
		track, _ := t.(map[string]interface{})
		if id, _ := track["trackId"].(string); id == trackID {
			ids, _ = track["guides"].([]interface{})
			return ids, true
		}
	}
	return nil, false
}

// resolveGuideIDs translates manifest guide ids into completion-record guide ids.
func resolveGuideIDs(packages []PackageEntry, ids []interface{}) []string {
	var guides []string
	for _, id := range ids {
		if s, ok := id.(string); ok {
			guides = append(guides, resolveMilestoneGuideID(packages, s))
		}
	}
	return guides
}

// loadLocalCatalogue decodes the embedded paths-cloud.json once per process.
func loadLocalCatalogue() ([]bundledPath, error) {
	catalogueOnce.Do(func() {
		var file bundledCatalogue
		if catalogueErr = json.Unmarshal(learningpaths.PathsCloudJSON, &file); catalogueErr == nil {
			catalogue = file.Paths
		}
	})
	return catalogue, catalogueErr
}

// resolveGuidesFromPathIndex reads a public docs site's index.json the way
// fetch-path-guides.ts does: skip params.grafana.skip, guide id is the permalink slug.
func resolveGuidesFromPathIndex(ctx context.Context, pathURL string) ([]string, error) {
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

	reqCtx, cancel := context.WithTimeout(ctx, pathIndexTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := pathIndexClient.Do(req)
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

// resolveMilestoneGuideID translates a manifest milestone id into the guide id
// its completion record carries: the last segment of the sibling index entry's
// path, which differs from the canonical id when the CDN uses templated slugs.
// Falls back to the milestone id when it has no entry of its own.
func resolveMilestoneGuideID(packages []PackageEntry, milestoneID string) string {
	for i := range packages {
		if packages[i].ID != milestoneID {
			continue
		}
		if slug := lastPathSegment(packages[i].Path); slug != "" {
			return slug
		}
		break
	}
	return milestoneID
}

func lastPathSegment(p string) string {
	trimmed := strings.Trim(p, "/")
	return trimmed[strings.LastIndex(trimmed, "/")+1:]
}
