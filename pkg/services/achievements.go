package services

import (
	"sort"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

type AchievementEventsResponse struct {
	EventID   string                  `json:"eventId"`
	Retry     bool                    `json:"retry"`
	Decisions []achievements.Decision `json:"decisions"`
}

type AchievementCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type AchievementAward struct {
	AchievementID string `json:"achievementId"`
	TierID        string `json:"tierId"`
	Entity        string `json:"entity"`
	EarnedAt      string `json:"earnedAt"`
}

// AchievementProgress is the points earned toward the lowest tier not held
// (Units) and that tier's goal (Next).
type AchievementProgress struct {
	AchievementID string `json:"achievementId"`
	Units         int    `json:"units"`
	Next          *int   `json:"next"`
}

type LegacyBadge struct {
	Source     string `json:"source"`
	Name       string `json:"name"`
	AcquiredAt string `json:"acquiredAt,omitempty"`
}

type MyAchievementsResponse struct {
	AsOf string `json:"asOf,omitempty"`
	// A change tells the client to refetch /definitions.
	DefinitionsVersion string                `json:"definitionsVersion,omitempty"`
	Capability         AchievementCapability `json:"capability"`
	Truncated          bool                  `json:"truncated"`
	Awards             []AchievementAward    `json:"awards"`
	Progress           []AchievementProgress `json:"progress"`
	Legacy             []LegacyBadge         `json:"legacy"`
}

func ShapeMyAchievements(rows achievements.Rows, defs *achievements.Snapshot) MyAchievementsResponse {
	catalog := defs.Catalog
	resp := MyAchievementsResponse{
		DefinitionsVersion: defs.Version,
		Capability:         AchievementCapability{Available: true},
		Truncated:          rows.Truncated,
		Awards:             make([]AchievementAward, 0, len(rows.Awards)),
		Progress:           make([]AchievementProgress, 0, len(rows.Progress)),
	}
	if !rows.AsOf.IsZero() {
		resp.AsOf = rows.AsOf.UTC().Format(time.RFC3339)
	}
	awarded := map[string][]string{}
	for _, aw := range rows.Awards {
		awarded[aw.AchievementID] = append(awarded[aw.AchievementID], aw.TierID)
		resp.Awards = append(resp.Awards, AchievementAward{
			AchievementID: aw.AchievementID,
			TierID:        aw.TierID,
			Entity:        aw.Entity,
			EarnedAt:      aw.EarnedAt.UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(resp.Awards, func(i, j int) bool {
		x, y := resp.Awards[i], resp.Awards[j]
		if x.AchievementID != y.AchievementID {
			return x.AchievementID < y.AchievementID
		}
		return awardBefore(catalog, x, y)
	})
	for _, p := range rows.Progress {
		units, next, known := catalog.Toward(p, awarded[p.AchievementID])
		if !known {
			continue
		}
		resp.Progress = append(resp.Progress, AchievementProgress{
			AchievementID: p.AchievementID,
			Units:         units,
			Next:          next,
		})
	}
	sort.Slice(resp.Progress, func(i, j int) bool { return resp.Progress[i].AchievementID < resp.Progress[j].AchievementID })
	return resp
}

// awardBefore orders by catalog rank; a tier id the catalog lacks sorts last.
func awardBefore(catalog *achievements.Catalog, x, y AchievementAward) bool {
	xr, xok := catalog.TierRank(x.AchievementID, x.TierID)
	yr, yok := catalog.TierRank(y.AchievementID, y.TierID)
	switch {
	case xok && yok:
		return xr < yr
	case xok != yok:
		return xok
	default:
		return x.TierID < y.TierID
	}
}
