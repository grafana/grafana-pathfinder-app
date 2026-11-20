package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"time"
)

const (
	achievementGroupVersion     = appPlatformGroup + "/v1alpha1"
	achievementProgressResource = "achievementprogresses"
	achievementAwardResource    = "achievementawards"
)

type achievementWriter = services.AchievementWriter

var errAchievementRowMismatch = services.ErrAchievementRowMismatch
var errAchievementPointsUnserved = services.ErrAchievementPointsUnserved
var achievementProgressName = services.AchievementProgressName
var achievementAwardName = services.AchievementAwardName

type achievementStore struct {
	client *appPlatformListClient
	writer achievementWriter
	now    func() time.Time
}

func newAchievementStore(c *appPlatformListClient, w achievementWriter, now func() time.Time) *achievementStore {
	return &achievementStore{client: c, writer: w, now: now}
}
func (s *achievementStore) shared() *services.AchievementStore {
	return services.NewAchievementStore(legacyAchievementClient{s.client}, s.writer, s.now)
}
func (s *achievementStore) LoadProgress(ctx context.Context, p achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	return s.shared().LoadProgress(ctx, p, ids)
}
func (s *achievementStore) CreateProgress(ctx context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	return s.shared().CreateProgress(ctx, p, row)
}
func (s *achievementStore) SaveProgress(ctx context.Context, p achievements.Person, row achievements.Progress) (achievements.Progress, error) {
	return s.shared().SaveProgress(ctx, p, row)
}
func (s *achievementStore) CreateAward(ctx context.Context, p achievements.Person, row achievements.Award) error {
	return s.shared().CreateAward(ctx, p, row)
}

type legacyAchievementClient struct{ *appPlatformListClient }

func (c legacyAchievementClient) Get(ctx context.Context, gv, ns, kind, name string, cap int64) ([]byte, error) {
	return c.get(ctx, gv, ns, kind, name, cap)
}
func (c legacyAchievementClient) Create(ctx context.Context, gv, ns, kind string, body []byte, cap int64) ([]byte, error) {
	return c.createRead(ctx, gv, ns, kind, body, cap)
}
func (c legacyAchievementClient) Replace(ctx context.Context, gv, ns, kind, name string, body []byte, cap int64) ([]byte, error) {
	return c.replaceRead(ctx, gv, ns, kind, name, body, cap)
}
func (c legacyAchievementClient) IsConflict(err error) bool { return isAlreadyExistsUpstream(err) }
func (c legacyAchievementClient) IsAbsent(err error, kind string) bool {
	return isAchievementRowAbsent(err, kind)
}

// A served kind names the missing object in the Status details. A group that
// does not serve the kind answers NotFound with empty details, which is an outage.
func isAchievementRowAbsent(err error, resource string) bool {
	var upstream *appPlatformUpstreamError
	if !errors.As(err, &upstream) || upstream.status != http.StatusNotFound {
		return false
	}
	var status struct {
		Kind    string `json:"kind"`
		Reason  string `json:"reason"`
		Details struct {
			Group string `json:"group"`
			Kind  string `json:"kind"`
			Name  string `json:"name"`
		} `json:"details"`
	}
	return json.Unmarshal(upstream.body, &status) == nil && status.Kind == "Status" && status.Reason == "NotFound" &&
		status.Details.Group == appPlatformGroup && status.Details.Kind == resource && status.Details.Name != ""
}
