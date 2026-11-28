package services

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"golang.org/x/sync/errgroup"
	"time"
)

const achievementReaderConcurrency = 8

type AchievementReader struct {
	Store   *AchievementStore
	Catalog *achievements.Catalog
	Now     func() time.Time
}

type heldAchievement struct {
	progress *achievements.Progress
	awards   []achievements.Award
}

func (r *AchievementReader) ListMine(ctx context.Context, person achievements.Person) (achievements.Rows, error) {
	asOf := r.Now()
	defs := r.Catalog.Achievements
	held := make([]heldAchievement, len(defs))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(achievementReaderConcurrency)
	for i := range defs {
		g.Go(func() error {
			h, err := r.readAchievement(gctx, person, &defs[i])
			held[i] = h
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return achievements.Rows{}, err
	}

	rows := achievements.Rows{AsOf: asOf, Awards: []achievements.Award{}, Progress: []achievements.Progress{}}
	for _, h := range held {
		if h.progress != nil {
			rows.Progress = append(rows.Progress, *h.progress)
		}
		rows.Awards = append(rows.Awards, h.awards...)
	}
	return rows, nil
}

func (r *AchievementReader) readAchievement(ctx context.Context, person achievements.Person, d *achievements.Definition) (heldAchievement, error) {
	loaded, err := r.Store.LoadProgress(ctx, person, []string{d.ID})
	if err != nil {
		return heldAchievement{}, err
	}
	var h heldAchievement
	row, found := loaded[d.ID]
	if found {
		if achievements.Classify(row) == achievements.ShapeRepairable {
			row = achievements.Normalize(row)
		}
		h.progress = &row
	}
	for _, tierID := range awardCandidates(d, row.TierIDs) {
		award, ok, err := r.Store.LoadAward(ctx, person, d.ID, tierID)
		if err != nil {
			return heldAchievement{}, err
		}
		if ok {
			h.awards = append(h.awards, award)
		}
	}
	return h, nil
}

// awardCandidates is the catalog's tiers plus the row's: the evaluator creates
// an award before saving the progress row that records it, so the row can lag.
func awardCandidates(d *achievements.Definition, rowTierIDs []string) []string {
	seen := make(map[string]bool, len(d.Tiers)+len(rowTierIDs))
	ids := make([]string, 0, len(d.Tiers)+len(rowTierIDs))
	for _, id := range append(tierIDsOf(d), rowTierIDs...) {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func tierIDsOf(d *achievements.Definition) []string {
	ids := make([]string, len(d.Tiers))
	for i, t := range d.Tiers {
		ids[i] = t.ID
	}
	return ids
}
