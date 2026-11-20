package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"slices"
)

type BundledPath struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Guides []string `json:"guides"`
}

func BundledPathGuides(logger log.Logger, loadLocalCatalogue func() ([]BundledPath, error), pathIndexFetch func(context.Context, string) ([]string, error)) PathGuideSource {
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]AssignmentGuideIdentity, bool, error) {
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
				return TrackNotFound(logger, targetID, trackID)
			}
			if len(path.Guides) > 0 {
				return GuideIdentities(path.Guides, "bundled"), true, nil
			}
			guides, err := pathIndexFetch(ctx, path.URL)
			if err != nil {
				return nil, true, err
			}
			if len(guides) == 0 {
				return nil, true, nil
			}
			return GuideIdentities(guides, "bundled"), true, nil
		}
		return nil, false, nil
	}
}

func GuideIdentities(ids []string, source string) []AssignmentGuideIdentity {
	var guides []AssignmentGuideIdentity
	for _, id := range ids {
		guides = append(guides, AssignmentGuideIdentity{GuideID: id, GuideSource: source})
	}
	return guides
}

func TrackNotFound(logger log.Logger, targetID, trackID string) ([]AssignmentGuideIdentity, bool, error) {
	logger.Warn("assignment track not found", "targetId", targetID, "trackId", trackID)
	return nil, true, nil
}

// Every required custom member must be published before the path can be evaluated.
func CustomPathGuides(entries []CatalogueEntry, logger log.Logger) PathGuideSource {
	published := map[string]bool{}
	for i := range entries {
		if entries[i].Status == "published" && entries[i].Manifest != nil {
			published[entries[i].ID] = true
		}
	}
	return func(_ context.Context, targetID, trackID, targetSource string) ([]AssignmentGuideIdentity, bool, error) {
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
				track := slices.IndexFunc(entry.Manifest.Tracks, func(t CatalogueTrack) bool { return t.TrackID == trackID })
				if entry.Manifest.Type != "path" || track < 0 {
					return TrackNotFound(logger, targetID, trackID)
				}
				ids = entry.Manifest.Tracks[track].Guides
			}
			var guides []AssignmentGuideIdentity
			for _, id := range ids {
				if !published[id] || id == "" {
					return nil, true, nil
				}
				guides = append(guides, AssignmentGuideIdentity{GuideID: id, GuideSource: "app-platform"})
			}
			return guides, true, nil
		}
		return nil, false, nil
	}
}

func ManifestTrackGuides(manifest map[string]interface{}, trackID string) (ids []interface{}, ok bool) {
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
