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

// shimHandleMyAssignments is the local stand-in for handleMyAssignments,
// compiled only under the pathfinderdev build tag. It does not ship.
// See docs/developer/LOCAL_DEV.md.
//
// A build tag rather than configuration: substituting the caller's identity
// must be absent from a shipped binary, not merely disabled in it
// (docs/design/BACKEND_PROXY_PATTERN.md §3).

// assignmentShimPath is where the shim's file lives inside the
// docker-compose stack: the repo root is mounted at /root/grafana-pathfinder-app
// (.config/docker-compose-base.yaml), and demo/ sits outside dist/, so a
// webpack build does not wipe it.
//
// A default path rather than a required env var: Grafana's plugin process
// does not reliably see container env. A missing file falls through to
// handleMyAssignments.
const assignmentShimPath = "/root/grafana-pathfinder-app/demo/assignments-fixture.json"

// assignmentShimEnvVar overrides that path when it does arrive — useful when
// running the plugin binary directly rather than under compose.
const assignmentShimEnvVar = "PATHFINDER_DEV_ASSIGNMENTS_FIXTURE"

// shimFallbackSubject is the subject canned entries are served as when
// the local stack forwards no ID token that verifies and the file names no
// subject of its own.
const shimFallbackSubject = "user:dev"

// assignmentShimFile is the on-disk shape: wire entries plus a subject.
// `satisfied` in the file is ignored; handleMyAssignments evaluates each row
// against shimCompletionRecords.
type assignmentShimFile struct {
	// Subject serves the entries as a specific user, so "another user's
	// obligations" is reachable locally without a second login. Optional: a
	// verified ID-token `sub` wins over it.
	Subject     string            `json:"subject"`
	Assignments []assignmentEntry `json:"assignments"`
}

var (
	assignmentShimMissingOnce sync.Once
	assignmentShimWarnOnce    sync.Once
)

func init() {
	shimHandleMyAssignments = shimHandleMyAssignmentsFromFile
}

// shimHandleMyAssignmentsFromFile reads the file on every request — deliberately
// not cached — so editing the JSON and refreshing the browser is the whole
// iteration loop, with no rebuild and no plugin restart. Any failure falls
// through to handleMyAssignments rather than erroring, so a typo in the JSON
// shows up as the ordinary capability envelope plus a log line.
func shimHandleMyAssignmentsFromFile(a *App, r *http.Request) ([]assignmentEntry, string, bool) {
	logger := a.ctxLogger(r.Context())

	path := assignmentShimPath
	if override := os.Getenv(assignmentShimEnvVar); override != "" {
		path = override
	}

	body, err := os.ReadFile(path) //nolint:gosec // dev-only build tag; the path is this developer's own
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			assignmentShimMissingOnce.Do(func() {
				logger.Info("no assignments shim file; handleMyAssignments continues", "path", path)
			})
		} else {
			logger.Error("reading assignments shim", "path", path, "error", err)
		}
		return nil, "", false
	}

	var file assignmentShimFile
	if err := json.Unmarshal(body, &file); err != nil {
		logger.Error("decoding assignments shim", "path", path, "error", err)
		return nil, "", false
	}

	// Loud, once per process: a build carrying this file must never be mistaken
	// for one enforcing the real identity and upstream gates.
	assignmentShimWarnOnce.Do(func() {
		logger.Warn("SERVING CANNED ASSIGNMENTS FROM A SHIM — identity and upstream gates bypassed",
			"path", path)
	})

	// Same lifecycle filter and sort as shapeAssignments. The shim must not
	// serve a withdrawn obligation or preserve file order.
	entries := []assignmentEntry{}
	for _, entry := range file.Assignments {
		if entry.Lifecycle == "" {
			entry.Lifecycle = assignmentLifecycleActive
		}
		if entry.Lifecycle != assignmentLifecycleActive {
			continue
		}
		entries = append(entries, entry)
	}
	sortAssignments(entries)

	return entries, shimSubject(a, r, file.Subject), true
}

// shimSubject prefers a genuinely verified subject, so the local loop
// exercises deriveAssignmentUserID whenever the stack can satisfy it and only
// substitutes when it cannot.
func shimSubject(a *App, r *http.Request, fileSubject string) string {
	if sub, status := a.subjectFromIDToken(r); status == identityVerified {
		return sub
	}
	if fileSubject != "" {
		return fileSubject
	}
	return shimFallbackSubject
}
