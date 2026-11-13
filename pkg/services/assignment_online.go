package services

import (
	"context"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type OnlinePackage struct {
	ID       string
	Path     string
	Manifest map[string]interface{}
}
type OnlineManifestReader func(context.Context, string) (map[string]interface{}, error)

func ResolveOnlinePathGuides(ctx context.Context, packages []OnlinePackage, logger log.Logger, targetID, trackID, targetSource string, fetchManifest OnlineManifestReader) ([]AssignmentGuideIdentity, bool, error) {
	if targetSource != "" && !OnlineAssignmentGuide(targetID).MatchesSource(targetSource) {
		return nil, false, nil
	}
	for i := range packages {
		entry := &packages[i]
		if entry.ID != targetID {
			continue
		}
		manifest := entry.Manifest
		if manifest == nil {
			var err error
			manifest, err = fetchManifest(ctx, entry.Path)
			if err != nil {
				return nil, true, err
			}
			if manifest == nil {
				return nil, true, nil
			}
		}
		ids, _ := manifest["milestones"].([]interface{})
		if trackID != "" {
			var ok bool
			if ids, ok = ManifestTrackGuides(manifest, trackID); !ok {
				return TrackNotFound(logger, targetID, trackID)
			}
		}
		guides, err := ResolveOnlineGuideIdentities(packages, ids)
		return guides, true, err
	}
	return nil, false, nil
}

func ResolveOnlineGuideIdentities(packages []OnlinePackage, ids []interface{}) ([]AssignmentGuideIdentity, error) {
	members := make(map[string]string, len(packages))
	for _, entry := range packages {
		members[entry.ID] = lastPathSegment(entry.Path)
	}
	var guides []AssignmentGuideIdentity
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
		guides = append(guides, OnlineAssignmentGuide(slug))
	}
	return guides, nil
}
