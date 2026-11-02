package plugin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const (
	achievementGroupVersion = appPlatformGroup + "/v1alpha1"

	achievementProgressResource = "achievementprogresses"
	achievementAwardResource    = "achievementawards"

	achievementKindProgress = "AchievementProgress"
	achievementKindAward    = "AchievementAward"

	achievementStoreMaxBytes = 256 * 1024
)

// Field names track kinds/achievementprogress.cue and kinds/achievementaward.cue
// in pathfinder-backend. The CRD requires units, so it must encode as [], not null.
type achievementProgressSpec struct {
	AchievementID  string   `json:"achievementId"`
	Tier           int64    `json:"tier"`
	Units          []string `json:"units"`
	Revision       int64    `json:"revision"`
	UpdatedAt      string   `json:"updatedAt"`
	UserID         string   `json:"userId"`
	OrgID          int64    `json:"orgId"`
	StackNamespace string   `json:"stackNamespace"`
	SchemaVersion  int64    `json:"schemaVersion"`
}

type achievementAwardSpec struct {
	AchievementID   string `json:"achievementId"`
	Tier            int64  `json:"tier"`
	Route           string `json:"route"`
	Revision        int64  `json:"revision"`
	EarnedAt        string `json:"earnedAt"`
	UserID          string `json:"userId"`
	UserLogin       string `json:"userLogin,omitempty"`
	UserDisplayName string `json:"userDisplayName,omitempty"`
	OrgID           int64  `json:"orgId"`
	StackNamespace  string `json:"stackNamespace"`
	SchemaVersion   int64  `json:"schemaVersion"`
}

type achievementObjectMeta struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
}

type achievementObject[S any] struct {
	APIVersion string                `json:"apiVersion"`
	Kind       string                `json:"kind"`
	Metadata   achievementObjectMeta `json:"metadata"`
	Spec       S                     `json:"spec"`
}

var errAchievementRowMismatch = errors.New("achievement store: stored row belongs to another user or achievement")

// achievementWriter is stamped from the verified request context, never an event body.
type achievementWriter struct {
	Namespace       string
	OrgID           int64
	UserLogin       string
	UserDisplayName string
}

type achievementStore struct {
	client *appPlatformListClient
	writer achievementWriter
	now    func() time.Time
}

var _ achievements.Store = (*achievementStore)(nil)

func newAchievementStore(client *appPlatformListClient, writer achievementWriter, now func() time.Time) *achievementStore {
	return &achievementStore{client: client, writer: writer, now: now}
}

func achievementName(parts ...string) string {
	h := sha256.New()
	for i, p := range parts {
		if i > 0 {
			h.Write([]byte{0})
		}
		h.Write([]byte(p))
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

func achievementProgressName(userID, achievementID string) string {
	return "achievement-progress-" + achievementName(userID, achievementID)
}

func achievementAwardName(userID, achievementID string, tier int) string {
	return "achievement-award-" + achievementName(userID, achievementID, strconv.Itoa(tier))
}

func (s *achievementStore) LoadProgress(ctx context.Context, person achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	out := make(map[string]achievements.Progress, len(ids))
	for _, id := range ids {
		body, err := s.client.get(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, achievementProgressName(person.ID, id), achievementStoreMaxBytes)
		if isNotFoundUpstream(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		obj, err := decodeAchievementProgress(body)
		if err != nil {
			return nil, err
		}
		if obj.Spec.UserID != person.ID || obj.Spec.AchievementID != id {
			return nil, errAchievementRowMismatch
		}
		out[id] = progressOf(obj)
	}
	return out, nil
}

func (s *achievementStore) CreateProgress(ctx context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	obj := s.progressObject(person, p)
	payload, err := json.Marshal(obj)
	if err != nil {
		return achievements.Progress{}, fmt.Errorf("achievement store: encode progress: %w", err)
	}
	body, err := s.client.createRead(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, payload, achievementStoreMaxBytes)
	if isAlreadyExistsUpstream(err) {
		return achievements.Progress{}, achievements.ErrExists
	}
	return writtenProgress(body, err)
}

func (s *achievementStore) SaveProgress(ctx context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	if p.Version == "" {
		return achievements.Progress{}, achievements.ErrConflict
	}
	obj := s.progressObject(person, p)
	obj.Metadata.ResourceVersion = p.Version
	payload, err := json.Marshal(obj)
	if err != nil {
		return achievements.Progress{}, fmt.Errorf("achievement store: encode progress: %w", err)
	}
	body, err := s.client.replaceRead(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, obj.Metadata.Name, payload, achievementStoreMaxBytes)
	if isAlreadyExistsUpstream(err) || isNotFoundUpstream(err) {
		return achievements.Progress{}, achievements.ErrConflict
	}
	return writtenProgress(body, err)
}

func (s *achievementStore) CreateAward(ctx context.Context, person achievements.Person, a achievements.Award) error {
	obj := achievementObject[achievementAwardSpec]{
		APIVersion: achievementGroupVersion,
		Kind:       achievementKindAward,
		Metadata:   achievementObjectMeta{Name: achievementAwardName(person.ID, a.AchievementID, a.Tier), Namespace: s.writer.Namespace},
		Spec: achievementAwardSpec{
			AchievementID:   a.AchievementID,
			Tier:            int64(a.Tier),
			Route:           a.Route,
			Revision:        int64(a.Revision),
			EarnedAt:        a.EarnedAt.UTC().Format(time.RFC3339),
			UserID:          person.ID,
			UserLogin:       boundedIdentityField(s.writer.UserLogin, completionMaxDisplayLen),
			UserDisplayName: boundedIdentityField(s.writer.UserDisplayName, completionMaxDisplayLen),
			OrgID:           s.writer.OrgID,
			StackNamespace:  s.writer.Namespace,
			SchemaVersion:   achievements.SchemaVersion,
		},
	}
	payload, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("achievement store: encode award: %w", err)
	}
	err = s.client.create(ctx, achievementGroupVersion, s.writer.Namespace, achievementAwardResource, payload, achievementStoreMaxBytes)
	if isAlreadyExistsUpstream(err) {
		return achievements.ErrExists
	}
	return err
}

func (s *achievementStore) progressObject(person achievements.Person, p achievements.Progress) achievementObject[achievementProgressSpec] {
	return achievementObject[achievementProgressSpec]{
		APIVersion: achievementGroupVersion,
		Kind:       achievementKindProgress,
		Metadata:   achievementObjectMeta{Name: achievementProgressName(person.ID, p.AchievementID), Namespace: s.writer.Namespace},
		Spec: achievementProgressSpec{
			AchievementID:  p.AchievementID,
			Tier:           int64(p.Tier),
			Units:          sortedDistinct(p.Units),
			Revision:       int64(p.Revision),
			UpdatedAt:      s.now().UTC().Format(time.RFC3339),
			UserID:         person.ID,
			OrgID:          s.writer.OrgID,
			StackNamespace: s.writer.Namespace,
			SchemaVersion:  int64(p.SchemaVersion),
		},
	}
}

func writtenProgress(body []byte, err error) (achievements.Progress, error) {
	if err != nil {
		return achievements.Progress{}, err
	}
	obj, err := decodeAchievementProgress(body)
	if err != nil {
		return achievements.Progress{}, err
	}
	return progressOf(obj), nil
}

func decodeAchievementProgress(body []byte) (achievementObject[achievementProgressSpec], error) {
	var obj achievementObject[achievementProgressSpec]
	if err := json.Unmarshal(body, &obj); err != nil {
		return obj, fmt.Errorf("achievement store: decode progress: %w", err)
	}
	if obj.Metadata.ResourceVersion == "" {
		return obj, errors.New("achievement store: progress response carried no resourceVersion")
	}
	return obj, nil
}

func progressOf(obj achievementObject[achievementProgressSpec]) achievements.Progress {
	return achievements.Progress{
		AchievementID: obj.Spec.AchievementID,
		Tier:          int(obj.Spec.Tier),
		Units:         sortedDistinct(obj.Spec.Units),
		Revision:      int(obj.Spec.Revision),
		SchemaVersion: int(obj.Spec.SchemaVersion),
		Version:       obj.Metadata.ResourceVersion,
	}
}

// The CRD cannot require order or uniqueness, so a row written directly under /apis may have neither.
func sortedDistinct(units []string) []string {
	out := slices.Clone(units)
	if out == nil {
		return []string{}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

func isNotFoundUpstream(err error) bool {
	status, ok := upstreamStatusOf(err)
	return ok && status == http.StatusNotFound && upstreamStatusReasonOf(err) == "NotFound"
}
