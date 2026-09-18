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

// Local-dev fixture for GET /assignments/my, compiled ONLY under the
// `pathfinderdev` build tag. See docs/developer/LOCAL_DEV.md for the build and
// run recipe.
//
// Why a build tag rather than configuration: the route's real path needs four
// things a local docker-compose stack cannot supply — a served aggregation
// layer for the .app group, a registered Assignment kind (RFC §11 dependency 8,
// not started), a provisioned CAP token to mint an on-behalf-of access token
// with, and a stack subject for the caller. Substituting all four means
// substituting the caller's identity too, and an identity substitution that
// could be switched on by configuration in a shipped binary is the kind of
// fail-open this proxy's whole trust boundary exists to prevent
// (docs/design/BACKEND_PROXY_PATTERN.md §3). A build tag makes the substitution
// absent from the artifact rather than merely disabled in it.

// assignmentFixtureDefaultPath is where the fixture lives inside the
// docker-compose stack: the repo root is mounted at /root/grafana-pathfinder-app
// (.config/docker-compose-base.yaml), and demo/ sits outside dist/, so a
// webpack build does not wipe it.
//
// A default path rather than a required env var, because Grafana constructs the
// environment it launches a backend plugin with; a variable set on the Grafana
// container is not reliably visible in this process. A missing file is the
// "off" state, so even a tagged build serves the real read path until someone
// puts a fixture there.
const assignmentFixtureDefaultPath = "/root/grafana-pathfinder-app/demo/assignments-fixture.json"

// assignmentFixtureEnvVar overrides that path when it does arrive — useful when
// running the plugin binary directly rather than under compose.
const assignmentFixtureEnvVar = "PATHFINDER_DEV_ASSIGNMENTS_FIXTURE"

// devFixtureFallbackSubject is the subject canned entries are served as when
// the local stack forwards no ID token that verifies and the fixture names no
// subject of its own.
const devFixtureFallbackSubject = "user:dev"

// devAssignmentFixture is the on-disk shape: the wire entries plus two dev-only
// knobs.
//
// Entries carry `satisfied` directly, which the real route will instead derive
// from the caller's completions (see unevaluatedSatisfaction). That is the
// point of the fixture — the UI has to render satisfied, outstanding and
// overdue states before that join exists.
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

	// Default, then filter, on the same rules shapeAssignments applies, and sort
	// the same way. A fixture must not be able to teach the UI something the
	// real route would never do — that file order is preserved, or that a
	// withdrawn obligation reaches the client.
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
