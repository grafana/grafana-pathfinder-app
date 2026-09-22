//go:build pathfinderdev

package plugin

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"sync"
)

// Local-dev fixture for GET /assignments/my, compiled only under the
// pathfinderdev build tag. See docs/developer/LOCAL_DEV.md.
//
// A build tag rather than configuration: substituting the caller's identity
// must be absent from a shipped binary, not merely disabled in it
// (docs/design/BACKEND_PROXY_PATTERN.md §3).

// assignmentFixtureDefaultPath is where the fixture lives inside the
// docker-compose stack: the repo root is mounted at /root/grafana-pathfinder-app
// (.config/docker-compose-base.yaml), and demo/ sits outside dist/, so a
// webpack build does not wipe it.
//
// A default path rather than a required env var: Grafana's plugin process
// does not reliably see container env. A missing file falls through to the
// real read path.
const assignmentFixtureDefaultPath = "/root/grafana-pathfinder-app/demo/assignments-fixture.json"

// assignmentFixtureEnvVar overrides that path when it does arrive — useful when
// running the plugin binary directly rather than under compose.
const assignmentFixtureEnvVar = "PATHFINDER_DEV_ASSIGNMENTS_FIXTURE"

// devFixtureFallbackSubject is the subject canned entries are served as when
// the local stack forwards no ID token that verifies and the fixture names no
// subject of its own.
const devFixtureFallbackSubject = "user:dev"

// devAssignmentFixture is the on-disk shape: wire entries plus a dev-only
// subject. Entries carry `satisfied` directly; the real route does not
// evaluate it yet (see unevaluatedSatisfaction).
type devAssignmentFixture struct {
	// Subject serves the entries as a specific user, so "another user's
	// obligations" is reachable locally without a second login. Optional: a
	// verified ID-token `sub` wins over it.
	Subject     string            `json:"subject"`
	Assignments []assignmentEntry `json:"assignments"`
}

var (
	devFixtureMissingOnce sync.Once
	devFixtureWarnOnce    sync.Once
)

func init() {
	assignmentDevHook = serveDevAssignmentFixture
}

// serveDevAssignmentFixture reads the fixture on every request — deliberately
// not cached — so editing the JSON and refreshing the browser is the whole
// iteration loop, with no rebuild and no plugin restart. Any failure to produce
// a fixture falls through to the real read path rather than erroring, so a typo
// in the JSON shows up as the ordinary capability envelope plus a log line, not
// as a broken route.
func serveDevAssignmentFixture(a *App, r *http.Request) ([]assignmentEntry, string, bool) {
	logger := a.ctxLogger(r.Context())

	path := assignmentFixtureDefaultPath
	if override := os.Getenv(assignmentFixtureEnvVar); override != "" {
		path = override
	}

	body, err := os.ReadFile(path) //nolint:gosec // dev-only build tag; the path is this developer's own
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			devFixtureMissingOnce.Do(func() {
				logger.Info("no dev assignments fixture; serving the real read path", "path", path)
			})
		} else {
			logger.Error("reading dev assignments fixture", "path", path, "error", err)
		}
		return nil, "", false
	}

	var fixture devAssignmentFixture
	if err := json.Unmarshal(body, &fixture); err != nil {
		logger.Error("decoding dev assignments fixture", "path", path, "error", err)
		return nil, "", false
	}

	// Loud, once per process: a build carrying this file must never be mistaken
	// for one enforcing the real identity and upstream gates.
	devFixtureWarnOnce.Do(func() {
		logger.Warn("SERVING CANNED ASSIGNMENTS FROM A DEV FIXTURE — identity and upstream gates bypassed",
			"path", path)
	})

	// Same lifecycle filter and sort as shapeAssignments. A fixture must not
	// serve a withdrawn obligation or preserve file order.
	entries := []assignmentEntry{}
	for _, entry := range fixture.Assignments {
		if entry.Lifecycle == "" {
			entry.Lifecycle = assignmentLifecycleActive
		}
		if entry.Lifecycle != assignmentLifecycleActive {
			continue
		}
		entries = append(entries, entry)
	}
	sortAssignments(entries)

	return entries, devFixtureSubject(a, r, fixture.Subject), true
}

// devFixtureSubject prefers a genuinely verified subject, so the local loop
// exercises the real identity path whenever the stack can satisfy it and only
// substitutes when it cannot.
func devFixtureSubject(a *App, r *http.Request, fixtureSubject string) string {
	if sub, status := a.subjectFromIDToken(r); status == identityVerified {
		return sub
	}
	if fixtureSubject != "" {
		return fixtureSubject
	}
	return devFixtureFallbackSubject
}
