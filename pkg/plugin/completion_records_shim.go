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

// shimCompletionRecords is the local stand-in for the completion-record
// list handleMyCompletions and callerCompletionRecords read, compiled only
// under the pathfinderdev build tag. It does not ship.
// See docs/developer/LOCAL_DEV.md.
//
// A build tag rather than configuration: substituting the caller's identity
// must be absent from a shipped binary, not merely disabled in it
// (docs/design/BACKEND_PROXY_PATTERN.md §3).
//
// handleMyCompletions and callerCompletionRecords both read this file, so
// a local stack evaluates obligations against the same rows it displays.

const completionRecordsShimPath = "/root/grafana-pathfinder-app/demo/completions-fixture.json"

const completionRecordsShimEnvVar = "PATHFINDER_DEV_COMPLETIONS_FIXTURE"

// completionRecordsShimFile is the on-disk shape: raw completion specs plus a
// subject. Rows are stamped with the served subject on read, so the file does
// not have to repeat userId.
type completionRecordsShimFile struct {
	Subject     string                 `json:"subject"`
	Completions []completionRecordSpec `json:"completions"`
}

var (
	completionRecordsShimMissingOnce sync.Once
	completionRecordsShimWarnOnce    sync.Once
)

func init() {
	shimCompletionRecords = shimCompletionRecordsFromFile
}

// shimCompletionRecordsFromFile reads the file on every request — deliberately
// not cached — so editing the JSON and refreshing the browser is the whole
// iteration loop. Any failure falls through to handleMyCompletions and
// callerCompletionRecords.
func shimCompletionRecordsFromFile(a *App, r *http.Request) ([]completionRecordSpec, string, bool) {
	logger := a.ctxLogger(r.Context())

	path := completionRecordsShimPath
	if override := os.Getenv(completionRecordsShimEnvVar); override != "" {
		path = override
	}

	body, err := os.ReadFile(path) //nolint:gosec // dev-only build tag; the path is this developer's own
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			completionRecordsShimMissingOnce.Do(func() {
				logger.Info("no completion-records shim file; the completion list continues", "path", path)
			})
		} else {
			logger.Error("reading dev completions fixture", "path", path, "error", err)
		}
		return nil, "", false
	}

	var file completionRecordsShimFile
	if err := json.Unmarshal(body, &file); err != nil {
		logger.Error("decoding completion-records shim", "path", path, "error", err)
		return nil, "", false
	}

	completionRecordsShimWarnOnce.Do(func() {
		logger.Warn("SERVING CANNED COMPLETIONS FROM A SHIM — identity and upstream gates bypassed",
			"path", path)
	})

	subject := shimSubject(a, r, file.Subject)
	records := make([]completionRecordSpec, len(file.Completions))
	for i, rec := range file.Completions {
		rec.UserID = subject
		records[i] = rec
	}
	return records, subject, true
}
