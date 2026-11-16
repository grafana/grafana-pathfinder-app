package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"golang.org/x/sync/errgroup"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const achievementReaderConcurrency = 8

// buildAchievementsBackend serves one request as the person the handler already
// verified, so the ID token is not verified again here.
func (a *App) buildAchievementsBackend(r *http.Request, person achievements.Person, catalog *achievements.Catalog) (achievementsBackend, string) {
	appURL, namespace, idToken, ok, reason := a.resolveCompletionConfig(r)
	if !ok {
		return achievementsBackend{}, reason
	}
	if a.oboExchanger == nil {
		return achievementsBackend{}, reasonOBOUnavailable
	}
	login, displayName := idTokenProfile(idToken)
	client := newAppPlatformListClient(appURL, a.oboExchanger, idToken, a.ctxLogger(r.Context()))
	store := newAchievementStore(client, achievementWriter{
		Namespace:       namespace,
		OrgID:           backend.PluginConfigFromContext(r.Context()).OrgID, //nolint:staticcheck // numeric orgId required by the CRD, as in the completion write path
		UserLogin:       login,
		UserDisplayName: displayName,
	}, timeNow)
	return achievementsBackend{
		store:  store,
		reader: &achievementNameReader{store: store, catalog: catalog, now: timeNow},
	}, ""
}

// achievementNameReader reads only the caller's rows, by their deterministic
// names, so it needs get and never a namespace-wide list.
type achievementNameReader struct {
	store   *achievementStore
	catalog *achievements.Catalog
	now     func() time.Time
}

var _ achievements.Reader = (*achievementNameReader)(nil)

type heldAchievement struct {
	progress *achievements.Progress
	awards   []achievements.Award
}

func (r *achievementNameReader) ListMine(ctx context.Context, person achievements.Person) (achievements.Rows, error) {
	asOf := r.now()
	defs := r.catalog.Achievements
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

func (r *achievementNameReader) readAchievement(ctx context.Context, person achievements.Person, d *achievements.Definition) (heldAchievement, error) {
	loaded, err := r.store.LoadProgress(ctx, person, []string{d.ID})
	if err != nil {
		return heldAchievement{}, err
	}
	var h heldAchievement
	row, found := loaded[d.ID]
	if found {
		h.progress = &row
	}
	for _, tierID := range awardCandidates(d, row.TierIDs) {
		award, ok, err := r.loadAward(ctx, person, d.ID, tierID)
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

func (r *achievementNameReader) loadAward(ctx context.Context, person achievements.Person, achievementID, tierID string) (achievements.Award, bool, error) {
	body, err := r.store.client.get(ctx, achievementGroupVersion, r.store.writer.Namespace, achievementAwardResource,
		achievementAwardName(person.ID, achievementID, tierID), achievementStoreMaxBytes)
	if isAchievementRowAbsent(err, achievementAwardResource) {
		return achievements.Award{}, false, nil
	}
	if err != nil {
		return achievements.Award{}, false, err
	}
	var obj achievementObject[achievementAwardSpec]
	if err := json.Unmarshal(body, &obj); err != nil {
		return achievements.Award{}, false, fmt.Errorf("achievement store: decode award: %w", err)
	}
	if obj.Spec.UserID != person.ID || obj.Spec.AchievementID != achievementID || obj.Spec.TierID != tierID {
		return achievements.Award{}, false, errAchievementRowMismatch
	}
	earnedAt, err := time.Parse(time.RFC3339, obj.Spec.EarnedAt)
	if err != nil {
		return achievements.Award{}, false, fmt.Errorf("achievement store: decode award earnedAt: %w", err)
	}
	return achievements.Award{
		AchievementID: obj.Spec.AchievementID,
		TierID:        obj.Spec.TierID,
		Entity:        obj.Spec.Entity,
		EarnedAt:      earnedAt,
	}, true, nil
}
