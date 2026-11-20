package services

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

type warnRecorder struct {
	log.Logger
	messages []string
}

func (w *warnRecorder) Warn(msg string, _ ...any) { w.messages = append(w.messages, msg) }

type pointsFreeClient struct{ body string }

func (c pointsFreeClient) Get(context.Context, string, string, string, string, int64) ([]byte, error) {
	return []byte(c.body), nil
}
func (c pointsFreeClient) Create(context.Context, string, string, string, []byte, int64) ([]byte, error) {
	return []byte(c.body), nil
}
func (c pointsFreeClient) Replace(context.Context, string, string, string, string, []byte, int64) ([]byte, error) {
	return []byte(c.body), nil
}
func (pointsFreeClient) IsConflict(error) bool       { return false }
func (pointsFreeClient) IsAbsent(error, string) bool { return false }

func TestAchievementStoreWarnsWhenTheKindDropsPointsFromAWrite(t *testing.T) {
	body := `{"metadata":{"resourceVersion":"7"},"spec":{"achievementId":"a","tierIds":[],"units":[],"userId":"user:1","schemaVersion":2}}`
	logger := &warnRecorder{}
	store := NewAchievementStore(pointsFreeClient{body}, AchievementWriter{Namespace: "ns"}, time.Now, logger)
	person := achievements.Person{ID: "user:1"}
	loaded, err := store.LoadProgress(context.Background(), person, []string{"a"})
	if err != nil || achievements.Classify(loaded["a"]) != achievements.ShapeRepairable {
		t.Fatalf("LoadProgress = %+v, %v, want a repairable row and no error", loaded, err)
	}
	_, err = store.SaveProgress(context.Background(), person, achievements.Progress{AchievementID: "a", SchemaVersion: achievements.ProgressSchemaVersion, Version: "7"})
	if !errors.Is(err, ErrAchievementPointsUnserved) {
		t.Fatalf("err = %v, want ErrAchievementPointsUnserved", err)
	}
	if len(logger.messages) != 1 || !strings.Contains(logger.messages[0], "required field") {
		t.Errorf("warnings = %q, want one naming the missing field", logger.messages)
	}
}

func TestAchievementStoreServesEveryRequiredFieldItWrites(t *testing.T) {
	store := NewAchievementStore(pointsFreeClient{}, AchievementWriter{Namespace: "ns"}, time.Now, &warnRecorder{})
	obj := store.progressObject(achievements.Person{ID: "user:1"}, achievements.Progress{AchievementID: "a", SchemaVersion: achievements.ProgressSchemaVersion})
	obj.Metadata.ResourceVersion = "1"
	if missing := progressOf(obj).MissingFields; len(missing) != 0 {
		t.Errorf("a row written in full reports %v missing; presentFields must cover every required field", missing)
	}
}
