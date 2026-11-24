package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const (
	achievementGroupVersion = "pathfinderbackend.ext.grafana.app" + "/v1alpha1"

	achievementProgressResource = "achievementprogresses"
	achievementAwardResource    = "achievementawards"

	achievementKindProgress = "AchievementProgress"
	achievementKindAward    = "AchievementAward"

	AchievementStoreMaxBytes = 256 * 1024
)

// Field names track kinds/achievementprogress.cue and kinds/achievementaward.cue
// in pathfinder-backend. The CRD requires tierIds, units and points, so the
// lists must encode as [], not null.
type achievementProgressSpec struct {
	AchievementID  string   `json:"achievementId"`
	TierIDs        []string `json:"tierIds"`
	Units          []string `json:"units"`
	Points         *int64   `json:"points"`
	UpdatedAt      string   `json:"updatedAt"`
	UserID         string   `json:"userId"`
	OrgID          int64    `json:"orgId"`
	StackNamespace string   `json:"stackNamespace"`
	SchemaVersion  int64    `json:"schemaVersion"`
}

type achievementAwardSpec struct {
	AchievementID   string `json:"achievementId"`
	TierID          string `json:"tierId"`
	Entity          string `json:"entity"`
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

var (
	ErrAchievementRowMismatch    = errors.New("achievement store: stored row belongs to another user or achievement")
	ErrAchievementPointsUnserved = achievements.ErrFieldUnserved
)

// AchievementWriter is stamped from the verified request context, never an event body.
type AchievementWriter struct {
	Namespace       string
	OrgID           int64
	UserLogin       string
	UserDisplayName string
}

type AchievementStore struct {
	client AchievementResourceClient
	writer AchievementWriter
	now    func() time.Time
	logger log.Logger
}

var _ achievements.Store = (*AchievementStore)(nil)

func NewAchievementStore(client AchievementResourceClient, writer AchievementWriter, now func() time.Time, logger log.Logger) *AchievementStore {
	return &AchievementStore{client: client, writer: writer, now: now, logger: logger}
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

func AchievementProgressName(userID, achievementID string) string {
	return "achievement-progress-" + achievementName(userID, achievementID)
}

func AchievementAwardName(userID, achievementID, tierID string) string {
	return "achievement-award-" + achievementName(userID, achievementID, tierID)
}

func (s *AchievementStore) LoadProgress(ctx context.Context, person achievements.Person, ids []string) (map[string]achievements.Progress, error) {
	out := make(map[string]achievements.Progress, len(ids))
	for _, id := range ids {
		body, err := s.client.Get(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, AchievementProgressName(person.ID, id), AchievementStoreMaxBytes)
		if s.client.IsAbsent(err, achievementProgressResource) {
			continue
		}
		if err != nil {
			return nil, err
		}
		obj, err := s.decodeProgress(body)
		if err != nil {
			return nil, err
		}
		if obj.Spec.UserID != person.ID || obj.Spec.AchievementID != id {
			return nil, ErrAchievementRowMismatch
		}
		out[id] = progressOf(obj)
	}
	return out, nil
}

func (s *AchievementStore) CreateProgress(ctx context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	obj := s.progressObject(person, p)
	payload, err := json.Marshal(obj)
	if err != nil {
		return achievements.Progress{}, fmt.Errorf("achievement store: encode progress: %w", err)
	}
	body, err := s.client.Create(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, payload, AchievementStoreMaxBytes)
	if s.client.IsConflict(err) {
		return achievements.Progress{}, achievements.ErrExists
	}
	s.warnIfRejected(p.AchievementID, err)
	return s.writtenProgress(body, err)
}

func (s *AchievementStore) SaveProgress(ctx context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	if p.Version == "" {
		return achievements.Progress{}, achievements.ErrConflict
	}
	obj := s.progressObject(person, p)
	obj.Metadata.ResourceVersion = p.Version
	payload, err := json.Marshal(obj)
	if err != nil {
		return achievements.Progress{}, fmt.Errorf("achievement store: encode progress: %w", err)
	}
	body, err := s.client.Replace(ctx, achievementGroupVersion, s.writer.Namespace, achievementProgressResource, obj.Metadata.Name, payload, AchievementStoreMaxBytes)
	if s.client.IsConflict(err) || s.client.IsAbsent(err, achievementProgressResource) {
		return achievements.Progress{}, achievements.ErrConflict
	}
	if err != nil {
		s.warnIfRejected(p.AchievementID, err)
		return achievements.Progress{}, err
	}
	stored, err := s.decodeProgress(body)
	if err != nil {
		// The 2xx means the save is durable. Without its Version, a later save gets ErrConflict and reloads.
		obj.Metadata.ResourceVersion = ""
		return progressOf(obj), nil
	}
	return s.acknowledged(stored)
}

func (s *AchievementStore) CreateAward(ctx context.Context, person achievements.Person, a achievements.Award) error {
	obj := achievementObject[achievementAwardSpec]{
		APIVersion: achievementGroupVersion,
		Kind:       achievementKindAward,
		Metadata:   achievementObjectMeta{Name: AchievementAwardName(person.ID, a.AchievementID, a.TierID), Namespace: s.writer.Namespace},
		Spec: achievementAwardSpec{
			AchievementID:   a.AchievementID,
			TierID:          a.TierID,
			Entity:          a.Entity,
			EarnedAt:        a.EarnedAt.UTC().Format(time.RFC3339),
			UserID:          person.ID,
			UserLogin:       BoundedIdentityField(s.writer.UserLogin, completionMaxDisplayLen),
			UserDisplayName: BoundedIdentityField(s.writer.UserDisplayName, completionMaxDisplayLen),
			OrgID:           s.writer.OrgID,
			StackNamespace:  s.writer.Namespace,
			SchemaVersion:   achievements.SchemaVersion,
		},
	}
	payload, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("achievement store: encode award: %w", err)
	}
	_, err = s.client.Create(ctx, achievementGroupVersion, s.writer.Namespace, achievementAwardResource, payload, AchievementStoreMaxBytes)
	if s.client.IsConflict(err) {
		return achievements.ErrExists
	}
	return err
}

func (s *AchievementStore) progressObject(person achievements.Person, p achievements.Progress) achievementObject[achievementProgressSpec] {
	points := int64(p.Points)
	return achievementObject[achievementProgressSpec]{
		APIVersion: achievementGroupVersion,
		Kind:       achievementKindProgress,
		Metadata:   achievementObjectMeta{Name: AchievementProgressName(person.ID, p.AchievementID), Namespace: s.writer.Namespace},
		Spec: achievementProgressSpec{
			AchievementID:  p.AchievementID,
			TierIDs:        sortedDistinct(p.TierIDs),
			Units:          sortedDistinct(p.Units),
			Points:         &points,
			UpdatedAt:      s.now().UTC().Format(time.RFC3339),
			UserID:         person.ID,
			OrgID:          s.writer.OrgID,
			StackNamespace: s.writer.Namespace,
			SchemaVersion:  int64(p.SchemaVersion),
		},
	}
}

func (s *AchievementStore) writtenProgress(body []byte, err error) (achievements.Progress, error) {
	if err != nil {
		return achievements.Progress{}, err
	}
	obj, err := s.decodeProgress(body)
	if err != nil {
		return achievements.Progress{}, err
	}
	return s.acknowledged(obj)
}

// acknowledged checks a row this store just wrote in full: one that comes back
// without a required field proves the deployed kind does not serve it.
func (s *AchievementStore) acknowledged(obj achievementObject[achievementProgressSpec]) (achievements.Progress, error) {
	row := progressOf(obj)
	if len(row.MissingFields) > 0 {
		s.logger.Warn("achievement progress rows come back without a required field; the AchievementProgress kind on this backend does not serve it", "achievementId", row.AchievementID, "fields", row.MissingFields)
		return achievements.Progress{}, fmt.Errorf("%w: %v", ErrAchievementPointsUnserved, row.MissingFields)
	}
	return row, nil
}

// A host that rejects a field it does not declare never acknowledges the write, so acknowledged cannot report it.
func (s *AchievementStore) warnIfRejected(achievementID string, err error) {
	if cause, ok := s.client.Rejection(err); ok {
		s.logger.Warn("the AchievementProgress kind on this backend rejected a progress write", "achievementId", achievementID, "cause", cause)
	}
}

func (s *AchievementStore) decodeProgress(body []byte) (achievementObject[achievementProgressSpec], error) {
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
	p := achievements.Progress{
		AchievementID: obj.Spec.AchievementID,
		TierIDs:       sortedDistinct(obj.Spec.TierIDs),
		Units:         sortedDistinct(obj.Spec.Units),
		Points:        pointsOf(obj.Spec),
		SchemaVersion: int(obj.Spec.SchemaVersion),
		Version:       obj.Metadata.ResourceVersion,
	}
	if p.SchemaVersion == achievements.ProgressSchemaVersion {
		p.MissingFields = achievements.MissingFields(presentFields(obj.Spec))
	}
	return p
}

// presentFields has an entry for every required field of the current version.
func presentFields(spec achievementProgressSpec) map[string]bool {
	return map[string]bool{achievements.FieldPoints: spec.Points != nil}
}

// A version 1 row predates points and starts at 0.
func pointsOf(spec achievementProgressSpec) int {
	if spec.Points == nil {
		return 0
	}
	return int(*spec.Points)
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

type AchievementResourceClient interface {
	Get(context.Context, string, string, string, string, int64) ([]byte, error)
	Create(context.Context, string, string, string, []byte, int64) ([]byte, error)
	Replace(context.Context, string, string, string, string, []byte, int64) ([]byte, error)
	IsConflict(error) bool
	IsAbsent(error, string) bool
	// Rejection returns the apiserver's cause when it refused a write as invalid.
	Rejection(error) (string, bool)
}

func (s *AchievementStore) LoadAward(ctx context.Context, person achievements.Person, achievementID, tierID string) (achievements.Award, bool, error) {
	body, err := s.client.Get(ctx, achievementGroupVersion, s.writer.Namespace, achievementAwardResource,
		AchievementAwardName(person.ID, achievementID, tierID), AchievementStoreMaxBytes)
	if s.client.IsAbsent(err, achievementAwardResource) {
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
		return achievements.Award{}, false, ErrAchievementRowMismatch
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
