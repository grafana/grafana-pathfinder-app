package plugin

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/src/constants"
)

func migratedTutorialIDs(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile("../../src/constants/bundled-tutorials.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func TestBundledTutorialAllowlistParity(t *testing.T) {
	ids := migratedTutorialIDs(t)
	if len(ids) != 7 {
		t.Fatalf("expected seven migrated tutorials, got %v", ids)
	}
	data, err := os.ReadFile("../../src/bundled-interactives/index.json")
	if err != nil {
		t.Fatal(err)
	}
	var index struct {
		Interactives []struct {
			ID string `json:"id"`
		} `json:"interactives"`
	}
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatal(err)
	}
	if len(index.Interactives) != len(ids) {
		t.Fatal("bundled index and shared allowlist differ")
	}
	for _, entry := range index.Interactives {
		if !constants.IsBundledTutorial(entry.ID) {
			t.Fatalf("backend allowlist missing frontend tutorial %q", entry.ID)
		}
	}
	for _, id := range []string{"first-dashboard-rss", "block-editor-tutorial", "e2e-framework-test", "first-dashboard/content.json", "unknown"} {
		if constants.IsBundledTutorial(id) {
			t.Fatalf("unexpected alias: %q", id)
		}
	}
}

func TestMigratedTutorialAssignmentSources(t *testing.T) {
	for _, id := range migratedTutorialIDs(t) {
		for _, targetSource := range []string{"bundled", "online-cdn", "interactive-tutorials"} {
			for _, recordSource := range []string{"bundled", "online-cdn", "interactive-tutorials", "app-platform", "untrusted", ""} {
				t.Run(id+"/"+targetSource+"/"+recordSource, func(t *testing.T) {
					guide := assignmentGuideIdentity{GuideID: id, GuideSource: targetSource}
					want := publicTutorialSource(recordSource) && (id != "first-dashboard" || recordSource == "bundled")
					row := completionRecordSpec{GuideID: id, GuideSource: recordSource, CompletionPercent: 100, CompletedAt: "2026-11-06T12:00:00Z"}
					pathSource := func(context.Context, string, string, string) ([]assignmentGuideIdentity, bool, error) {
						return []assignmentGuideIdentity{guide}, true, nil
					}
					ev := newTestEvaluator(pathSource)
					for _, kind := range []string{assignmentTargetGuide, assignmentTargetPath} {
						targetID := id
						if kind == assignmentTargetPath {
							targetID = "online-path"
						}
						asg := assignmentSpec{TargetType: kind, TargetID: targetID, TargetSource: targetSource, AcceptCompletionsFrom: "2026-11-01T00:00:00Z"}
						got := mustGuideProgress(t, ev, asg, []completionRecordSpec{row})
						if satisfiedFromGuides(got) != want {
							t.Fatalf("%s: %+v, want completed %v", kind, got, want)
						}
						identities, err := ev.assignmentGuides(asg)
						if err != nil || containsAssignmentGuide(identities, row) != want {
							t.Fatalf("repair parity: %v, %v", identities, err)
						}
						for _, invalid := range []completionRecordSpec{
							{GuideID: id, GuideSource: recordSource, CompletionPercent: 99, CompletedAt: row.CompletedAt},
							{GuideID: id, GuideSource: recordSource, CompletionPercent: 100},
							{GuideID: id, GuideSource: recordSource, CompletionPercent: 100, CompletedAt: "2026-10-01T00:00:00Z"},
						} {
							if satisfiedFromGuides(mustGuideProgress(t, ev, asg, []completionRecordSpec{invalid})) {
								t.Fatal("nonterminal or old evidence granted credit")
							}
						}
					}
				})
			}
		}
	}
}

func TestMigratedTutorialPrivateSourceIsolation(t *testing.T) {
	for _, id := range migratedTutorialIDs(t) {
		private := assignmentGuideIdentity{GuideID: id, GuideSource: "app-platform"}
		for _, source := range []string{"bundled", "online-cdn", "interactive-tutorials"} {
			if assignmentGuideMatchesCompletion(private, completionRecordSpec{GuideID: id, GuideSource: source}) {
				t.Fatal("public completion granted private credit")
			}
		}
	}
	if assignmentGuideMatchesCompletion(onlineAssignmentGuide("unrelated"), completionRecordSpec{GuideID: "unrelated", GuideSource: "bundled"}) {
		t.Fatal("non-allowlisted guide gained an alias")
	}
}
