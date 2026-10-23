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

// Source qualification prevents same-slug guides in other repositories from granting credit.
type assignmentGuideIdentity struct {
	GuideID         string
	GuideSource     string
	alternateSource string
}

func assignmentGuideMatchesCompletion(guide assignmentGuideIdentity, rec completionRecordSpec) bool {
	return guide.GuideID == rec.GuideID && guide.matchesSource(rec.GuideSource)
}

func (guide assignmentGuideIdentity) matchesSource(source string) bool {
	return source != "" && (guide.GuideSource == source || guide.alternateSource == source)
}

func onlineAssignmentGuide(id string) assignmentGuideIdentity {
	// The CDN and recommender resolvers name the same public content differently.
	return assignmentGuideIdentity{GuideID: id, GuideSource: "online-cdn", alternateSource: "interactive-tutorials"}
}

// A found target with no guides is unresolved; an error must never mean outstanding.
type pathGuideSource func(ctx context.Context, targetID, trackID, targetSource string) (guides []assignmentGuideIdentity, found bool, err error)

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

func bundledPathGuides(logger log.Logger) pathGuideSource {
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
		if targetSource != "" && targetSource != "bundled" {
			return nil, false, nil
		}
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
				return guideIdentities(path.Guides, "bundled"), true, nil
			}
			guides, err := pathIndexFetch(ctx, path.URL)
			if err != nil {
				return nil, true, err
			}
			if len(guides) == 0 {
				return nil, true, nil
			}
			return guideIdentities(guides, "bundled"), true, nil
		}
		return nil, false, nil
	}
}

func guideIdentities(ids []string, source string) []assignmentGuideIdentity {
	var guides []assignmentGuideIdentity
	for _, id := range ids {
		guides = append(guides, assignmentGuideIdentity{GuideID: id, GuideSource: source})
	}
	return guides
}

func trackNotFound(logger log.Logger, targetID, trackID string) ([]assignmentGuideIdentity, bool, error) {
	logger.Warn("assignment track not found", "targetId", targetID, "trackId", trackID)
	return nil, true, nil
}

// Every required custom member must be published before the path can be evaluated.
func customPathGuides(entries []customGuideRepositoryEntry, logger log.Logger) pathGuideSource {
	published := map[string]bool{}
	for i := range entries {
		if entries[i].Status == "published" && entries[i].Manifest != nil {
			published[entries[i].ID] = true
		}
	}
	return func(_ context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
		for i := range entries {
			entry := &entries[i]
			if entry.ID != targetID || entry.Status != "published" || entry.Manifest == nil || (targetSource != "" && targetSource != "app-platform") {
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
			var guides []assignmentGuideIdentity
			for _, id := range ids {
				if !published[id] || id == "" {
					return nil, true, nil
				}
				guides = append(guides, assignmentGuideIdentity{GuideID: id, GuideSource: "app-platform"})
			}
			return guides, true, nil
		}
		return nil, false, nil
	}
}

func (a *App) onlinePathGuides(logger log.Logger) pathGuideSource {
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
		if targetSource != "" && !onlineAssignmentGuide(targetID).matchesSource(targetSource) {
			return nil, false, nil
		}
		resp, err := a.getCachedPackageRecommendations(ctx)
		if err != nil {
			return nil, false, err
		}
		return a.resolveOnlinePathGuides(ctx, resp, logger, targetID, trackID, targetSource)
	}
}

func (a *App) resolveOnlinePathGuides(ctx context.Context, resp *PackageRecommendationsResponse, logger log.Logger, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
	if targetSource != "" && !onlineAssignmentGuide(targetID).matchesSource(targetSource) {
		return nil, false, nil
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
		guides, err := a.resolveOnlineGuideIdentities(ctx, resp, ids)
		return guides, true, err
	}
	return nil, false, nil
}

// Only path manifests may declare assignment tracks.
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

func (a *App) resolveOnlineGuideIdentities(_ context.Context, resp *PackageRecommendationsResponse, ids []interface{}) ([]assignmentGuideIdentity, error) {
	members := make(map[string]string, len(resp.Packages))
	for _, entry := range resp.Packages {
		members[entry.ID] = lastPathSegment(entry.Path)
	}
	var guides []assignmentGuideIdentity
	for _, id := range ids {
		memberID, ok := id.(string)
		if !ok || memberID == "" {
			return nil, nil
		}
		slug := members[memberID]
		if slug == "" {
			return nil, nil
		}
		// Recorders use the URL slug and resolver repository, never the member manifest's source.
		guides = append(guides, onlineAssignmentGuide(slug))
	}
	return guides, nil
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
