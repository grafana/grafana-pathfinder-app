package plugin

import (
	"context"
	"net/http"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

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

func (r *achievementNameReader) ListMine(ctx context.Context, person achievements.Person) (achievements.Rows, error) {
	reader := services.AchievementReader{Store: r.store.shared(), Catalog: r.catalog, Now: r.now}
	return reader.ListMine(ctx, person)
}
