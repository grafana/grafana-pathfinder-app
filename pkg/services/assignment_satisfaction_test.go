package services

import (
	"context"
	"errors"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestAssignmentSyncSkipsSatisfiedAndUnrelated(t *testing.T) {
	done := true
	for _, rec := range []Assignment{
		{Name: "already-satisfied", TargetType: "guide", TargetID: "mine", TargetSource: "bundled", StatusSatisfied: &done},
		{Name: "different-guide", TargetType: "guide", TargetID: "other", TargetSource: "bundled"},
	} {
		t.Run(rec.Name, func(t *testing.T) {
			ev := &ObligationEvaluator{Context: context.Background(), Logger: log.DefaultLogger}
			SyncSatisfiedAssignments([]Assignment{rec}, CompletionRecord{GuideID: "mine", GuideSource: "bundled"}, ev, func() ([]CompletionRecord, error) {
				t.Fatal("read completion history for an ineligible assignment")
				return nil, nil
			}, func(Assignment) { t.Fatal("marked ineligible assignment") }, log.DefaultLogger)
		})
	}
}

func TestCustomPathWithDraftMemberStaysUnresolved(t *testing.T) {
	resolve := CustomPathGuides([]CatalogueEntry{{ID: "path", Status: "published", Manifest: &CatalogueManifest{Type: "path", Milestones: []string{"member"}}}, {ID: "member", Status: "draft", Manifest: &CatalogueManifest{Type: "guide"}}}, log.DefaultLogger)
	guides, found, err := resolve(context.Background(), "path", "", "app-platform")
	if !found || err != nil || len(guides) != 0 {
		t.Fatalf("guides=%v found=%v error=%v", guides, found, err)
	}
}

func TestBundledPathIndexFailureAndUncheckableAssignment(t *testing.T) {
	indexErr := errors.New("index unavailable")
	resolve := BundledPathGuides(log.DefaultLogger, func() ([]BundledPath, error) { return []BundledPath{{ID: "path", URL: "index"}}, nil }, func(context.Context, string) ([]string, error) { return nil, indexErr })
	_, found, err := resolve(context.Background(), "path", "", "bundled")
	if !found || !errors.Is(err, indexErr) {
		t.Fatalf("found=%v error=%v", found, err)
	}
	rows := ShapeAssignments(log.DefaultLogger, []Assignment{{TargetType: "path", TargetID: "path"}}, func(Assignment) ([]AssignmentGuideEntry, error) { return nil, ErrAssignmentUncheckable })
	if len(rows) != 0 {
		t.Fatal("uncheckable assignment reported as unmet")
	}
}
