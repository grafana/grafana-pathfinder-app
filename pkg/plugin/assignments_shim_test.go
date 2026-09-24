//go:build pathfinderdev

package plugin

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// The committed fixture is the local loop's whole input, and nothing else reads
// it — so without this it can rot into invalid JSON or a stale field name and
// the only symptom is a confusing empty panel days later.
func TestShimHandleMyAssignments_CommittedFileLoads(t *testing.T) {
	t.Setenv(assignmentShimEnvVar, filepath.Join("..", "..", "demo", "assignments-fixture.json"))

	r, _ := http.NewRequest(http.MethodGet, "/assignments/my", nil)
	entries, subject, handled := shimHandleMyAssignmentsFromFile(newTestApp(t), r)

	if !handled {
		t.Fatal("committed fixture did not load; check demo/assignments-fixture.json")
	}
	if subject != "user:dev" {
		t.Errorf("subject = %q, want the fixture's own subject", subject)
	}
	if len(entries) == 0 {
		t.Fatal("fixture produced no entries")
	}

	for _, entry := range entries {
		if entry.TargetID == "deprecated-onboarding" {
			t.Error("a withdrawn obligation reached the client; the lifecycle filter regressed")
		}
		if (entry.TargetType != "path" && entry.TargetType != "guide") || entry.TargetID == "" {
			t.Errorf("entry = %+v; the fixture must name targetType and targetId", entry)
		}
		if entry.Lifecycle != assignmentLifecycleActive {
			t.Errorf("entry %q has lifecycle %q; only active obligations may be served",
				entry.TargetID, entry.Lifecycle)
		}
	}

	// The states the UI is being built against. If someone trims the fixture,
	// they should have to say so here.
	var withoutDeadline, satisfied, tracked int
	for _, entry := range entries {
		if entry.DueAt == "" {
			withoutDeadline++
		}
		if entry.Satisfied {
			satisfied++
		}
		if entry.TrackID != "" {
			tracked++
		}
	}
	if withoutDeadline == 0 {
		t.Error("fixture has no deadline-free obligation, which is the only shape MVP actually writes")
	}
	if satisfied == 0 {
		t.Error("fixture has no satisfied obligation, so the UI cannot render that state")
	}
	if tracked == 0 {
		t.Error("fixture has no track-qualified target")
	}
}

// A missing or malformed file must fall through to handleMyAssignments, not
// break the route: a typo in the JSON should look like the ordinary capability
// envelope plus a log line.
func TestShimHandleMyAssignments_FallsThroughOnBadInput(t *testing.T) {
	cases := map[string]string{
		"missing file": filepath.Join(t.TempDir(), "nope.json"),
		"malformed":    writeTempFixture(t, "{ not json"),
		"wrong shape":  writeTempFixture(t, `{"assignments": "not an array"}`),
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv(assignmentShimEnvVar, path)

			r, _ := http.NewRequest(http.MethodGet, "/assignments/my", nil)
			_, _, handled := shimHandleMyAssignmentsFromFile(newTestApp(t), r)

			if handled {
				t.Error("handled a fixture it could not read; the route must fall through instead")
			}
		})
	}
}

// The committed fixtures are the local loop's input, dated 2026-09-23.
// alerting-basics is met. linux-monitoring has no completions.
// observability-basics is missing one guide. getting-started's middle guide
// is before acceptCompletionsFrom. The track-qualified row stays unmet.
func TestShimHandleMyAssignments_EvaluateCases(t *testing.T) {
	t.Setenv(assignmentShimEnvVar, filepath.Join("..", "..", "demo", "assignments-fixture.json"))
	t.Setenv(completionRecordsShimEnvVar, filepath.Join("..", "..", "demo", "completions-fixture.json"))
	prev := pathIndexFetch
	pathIndexFetch = func(context.Context, string) ([]string, error) {
		return nil, os.ErrClosed
	}
	t.Cleanup(func() { pathIndexFetch = prev })

	r, _ := http.NewRequest(http.MethodGet, "/assignments/my", nil)
	_, resp := doMyAssignmentsReq(t, r)
	got := map[string]bool{}
	for _, entry := range resp.Assignments {
		got[entry.TargetID] = entry.Satisfied
	}
	want := map[string]bool{
		"alerting-basics":      true,
		"linux-monitoring":     false,
		"observability-basics": false,
		"getting-started":      false,
		"logs-dashboards":      false,
	}
	for id, satisfied := range want {
		gotSatisfied, ok := got[id]
		if !ok {
			t.Errorf("missing %s: %+v", id, resp.Assignments)
			continue
		}
		if gotSatisfied != satisfied {
			t.Errorf("%s satisfied = %v, want %v", id, gotSatisfied, satisfied)
		}
	}
}

func TestShimHandleMyAssignments_VerifiedSubjectWins(t *testing.T) {
	t.Setenv(assignmentShimEnvVar, writeTempFixture(t,
		`{"subject":"user:dev","assignments":[{"targetType":"path","targetId":"p","satisfied":false}]}`))

	r := completionRequest(t, "/assignments/my", "user:real")
	entries, subject, handled := shimHandleMyAssignmentsFromFile(newTestApp(t), r)
	if !handled || len(entries) != 1 {
		t.Fatalf("handled = %v, entries = %+v", handled, entries)
	}
	if subject != "user:real" {
		t.Errorf("subject = %q, want the verified ID-token sub", subject)
	}
}

func writeTempFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}
