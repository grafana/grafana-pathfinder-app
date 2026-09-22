//go:build pathfinderdev

package plugin

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// The committed fixture is the local loop's whole input, and nothing else reads
// it — so without this it can rot into invalid JSON or a stale field name and
// the only symptom is a confusing empty panel days later.
func TestDevAssignmentFixture_CommittedFileLoads(t *testing.T) {
	t.Setenv(assignmentFixtureEnvVar, filepath.Join("..", "..", "demo", "assignments-fixture.json"))

	r, _ := http.NewRequest(http.MethodGet, "/assignments/my", nil)
	entries, subject, handled := serveDevAssignmentFixture(newTestApp(t), r)

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
		if entry.TargetType != "path" || entry.TargetID == "" {
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

// A missing or malformed fixture must fall through to the real read path, not
// break the route: a typo in the JSON should look like the ordinary capability
// envelope plus a log line.
func TestDevAssignmentFixture_FallsThroughOnBadInput(t *testing.T) {
	cases := map[string]string{
		"missing file": filepath.Join(t.TempDir(), "nope.json"),
		"malformed":    writeTempFixture(t, "{ not json"),
		"wrong shape":  writeTempFixture(t, `{"assignments": "not an array"}`),
	}

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv(assignmentFixtureEnvVar, path)

			r, _ := http.NewRequest(http.MethodGet, "/assignments/my", nil)
			_, _, handled := serveDevAssignmentFixture(newTestApp(t), r)

			if handled {
				t.Error("handled a fixture it could not read; the route must fall through instead")
			}
		})
	}
}

// A verified ID token beats the fixture's subject, so the local loop exercises
// the real identity path whenever the stack can satisfy it.
func TestDevAssignmentFixture_VerifiedSubjectWinsOverFixture(t *testing.T) {
	t.Setenv(assignmentFixtureEnvVar, writeTempFixture(t,
		`{"subject":"user:dev","assignments":[{"targetType":"path","targetId":"p","satisfied":false}]}`))

	r := completionRequest(t, "/assignments/my", "user:real")
	entries, subject, handled := serveDevAssignmentFixture(newTestApp(t), r)
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
