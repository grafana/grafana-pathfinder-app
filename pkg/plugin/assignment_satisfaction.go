package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/src/learning-paths"
)

// Obligation evaluation for GET /assignments/my (PATH_ASSIGNMENTS.md §6.12,
// §7.4): does the caller's completion set satisfy an assignment's target?
// One completion row has to meet a guide on its own; collateByUser keeps
// latestCompletedAt and maxCompletionPercent from different rows, so this
// join reads the raw specs instead. Two consumers share this evaluation:
// satisfactionFunc (the live GET) and writeSatisfiedAssignments (the §6.12
// status cache, written from the completion write path).

const pathIndexTimeout = 10 * time.Second

// A path's guides come from two sources, merged in the same order
// learning-paths.hook.ts merges them: the bundled catalogue (source 1) and
// the namespace's published custom paths/journeys (source 2, appPlatformPaths).
// Source 1 has an accessory: a bundled entry with no inline guides points at a docs index.json instead
// (resolveGuidesFromPathIndex fetches it lazily, still under source 1).

type bundledPath struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Guides []string `json:"guides"`
}

type bundledCatalogue struct {
	Paths []bundledPath `json:"paths"`
}

var (
	catalogueOnce sync.Once
	catalogue     []bundledPath
	catalogueErr  error

	// pathIndexFetch is overridden in tests
	pathIndexFetch = resolveGuidesFromPathIndex

	// ossPathShim is nil in every shipped build. The pathfinderdev build is
	// the only thing that sets it, to paths.json. Removed with that dev path.
	ossPathShim func() ([]bundledPath, error)
)

// loadLocalCatalogue is source 1: the embedded paths-cloud.json, decoded once
// per process.
func loadLocalCatalogue() ([]bundledPath, error) {
	catalogueOnce.Do(func() {
		var file bundledCatalogue
		if catalogueErr = json.Unmarshal(learningpaths.PathsCloudJSON, &file); catalogueErr == nil {
			catalogue = file.Paths
		}
	})
	return catalogue, catalogueErr
}

// appPlatformPaths is source 2: the namespace's published custom paths and
// journeys, normalized into bundledPath so paths() can merge them with
// source 1 in one lookup. Keeps only milestones that are themselves
// published, matching the guide list gate in app-platform-paths.ts.
func appPlatformPaths(entries []customGuideRepositoryEntry) []bundledPath {
	published := map[string]struct{}{}
	for i := range entries {
		if entries[i].Status == "published" {
			published[entries[i].ID] = struct{}{}
		}
	}
	var paths []bundledPath
	for i := range entries {
		entry := &entries[i]
		if entry.Status != "published" || entry.Manifest == nil {
			continue
		}
		if entry.Manifest.Type != "path" && entry.Manifest.Type != "journey" {
			continue
		}
		ids := make([]string, 0, len(entry.Manifest.Milestones))
		for _, milestone := range entry.Manifest.Milestones {
			if _, ok := published[milestone]; ok {
				ids = append(ids, milestone)
			}
		}
		paths = append(paths, bundledPath{ID: entry.ID, Guides: ids})
	}
	return paths
}

var pathIndexClient = &http.Client{
	Timeout: pathIndexTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// resolveGuidesFromPathIndex is source 1's accessory, fetched lazily for a
// bundled entry that has a URL instead of inline guides — never called for
// an App Platform entry (source 2), which always resolves from its manifest
// directly. This is a public docs site's index.json (Hugo/Jekyll page
// listing), not App Platform. Reads it the way fetch-path-guides.ts does:
// skip params.grafana.skip, guide id is the permalink slug.
func resolveGuidesFromPathIndex(ctx context.Context, pathURL string) ([]string, error) {
	if !strings.HasSuffix(pathURL, "/") {
		pathURL += "/"
	}
	endpoint, err := url.Parse(pathURL)
	if err != nil {
		return nil, err
	}
	if endpoint.Scheme != "https" || endpoint.Host == "" {
		return nil, fmt.Errorf("path index url must be https")
	}
	endpoint.Path += "index.json"
	endpoint.RawQuery = ""
	endpoint.Fragment = ""

	reqCtx, cancel := context.WithTimeout(ctx, pathIndexTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := pathIndexClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	var items []struct {
		Relpermalink string `json:"relpermalink"`
		Params       struct {
			Grafana struct {
				Skip bool `json:"skip"`
			} `json:"grafana"`
		} `json:"params"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.Params.Grafana.Skip {
			continue
		}
		slug := strings.TrimRight(item.Relpermalink, "/")
		if i := strings.LastIndex(slug, "/"); i >= 0 {
			slug = slug[i+1:]
		}
		if slug == "" {
			continue
		}
		ids = append(ids, slug)
	}
	return ids, nil
}

// obligationEvaluator resolves an assignment target to the guides that must
// be complete (assignmentGuides, via paths()), then tests the caller's raw
// completion rows against that set (met). One evaluator serves one request,
// reused across every assignment in it so source 2's LIST and each target's
// resolved guide list are each fetched at most once. The kind also allows a
// guide target; MVP does not evaluate one.
type obligationEvaluator struct {
	ctx        context.Context
	logger     log.Logger
	guides     []customGuideRepositoryEntry
	guidesOK   bool
	guideLists map[string]guideList

	pathsLoaded bool
	pathsCache  []bundledPath
}

// paths is the merged catalogue assignmentGuides resolves a target against:
// source 1 (local, bundled) then source 2 (remote App Platform, already
// drained by newObligationEvaluator) appended after it. Computed once per
// evaluator. Source 1's docs-index accessory stays out of this merge — it's
// per-path and fetched lazily, only for the one bundled entry an assignment
// actually targets.
func (e *obligationEvaluator) paths() []bundledPath {
	if e.pathsLoaded {
		return e.pathsCache
	}
	e.pathsLoaded = true
	paths, err := loadLocalCatalogue()
	if ossPathShim != nil {
		paths, err = ossPathShim()
	}
	if err != nil {
		e.logger.Info("bundled path catalogue unavailable", "error", err)
		paths = nil
	}
	if e.guidesOK {
		paths = append(paths, appPlatformPaths(e.guides)...)
	}
	e.pathsCache = paths
	return paths
}

// guideList is the guides one assignment requires. resolved is false when
// that list could not be determined; met treats that as unmet.
type guideList struct {
	guides   []string
	resolved bool
}

// met is the satisfaction predicate: every guide assignmentGuides resolved
// for asg needs one completion row on or after acceptCompletionsFrom, if set.
func (e *obligationEvaluator) met(asg assignmentSpec, completions []completionRecordSpec) bool {
	res := e.assignmentGuides(asg)
	if !res.resolved || len(res.guides) == 0 {
		return false
	}
	var accept time.Time
	hasAccept := false
	if asg.AcceptCompletionsFrom != "" {
		parsed, ok := parseCompletionTime(asg.AcceptCompletionsFrom)
		if !ok {
			return false
		}
		accept, hasAccept = parsed, true
	}
	for _, guideID := range res.guides {
		done := false
		for _, rec := range completions {
			if rec.GuideID != guideID {
				continue
			}
			at, ok := parseCompletionTime(rec.CompletedAt)
			if !ok {
				continue
			}
			if hasAccept && at.Before(accept) {
				continue
			}
			done = true
			break
		}
		if !done {
			return false
		}
	}
	return true
}

// assignmentGuides is the guides an assignment requires, walking the same
// two sources the client merges. A guide target is logged and left
// unresolved; MVP evaluates paths only. A track also stays unresolved: this
// process has no track manifest, and grading the whole path would mark a
// narrower obligation done. One evaluation reuses the first result for the
// same target.
func (e *obligationEvaluator) assignmentGuides(asg assignmentSpec) (res guideList) {
	if e.guideLists == nil {
		e.guideLists = map[string]guideList{}
	}
	key := asg.TargetType + "\x00" + asg.TargetID + "\x00" + asg.TrackID + "\x00" + asg.TargetSource
	if cached, ok := e.guideLists[key]; ok {
		return cached
	}
	defer func() { e.guideLists[key] = res }()

	if asg.TargetType == "guide" {
		e.logger.Error("assignment guide target is not evaluated", "targetType", asg.TargetType, "targetId", asg.TargetID)
		return guideList{}
	}
	if asg.TargetType != "path" || asg.TrackID != "" || asg.TargetID == "" {
		return guideList{}
	}

	for _, path := range e.paths() {
		if path.ID != asg.TargetID || (len(path.Guides) == 0 && path.URL == "") {
			continue
		}
		if len(path.Guides) > 0 {
			return guideList{guides: path.Guides, resolved: true}
		}
		guides, err := pathIndexFetch(e.ctx, path.URL)
		if err != nil {
			e.logger.Info("path index unavailable", "targetId", asg.TargetID, "error", err)
			return guideList{}
		}
		if len(guides) == 0 {
			return guideList{}
		}
		return guideList{guides: guides, resolved: true}
	}
	return guideList{}
}

// newObligationEvaluator builds one evaluator per request, draining source 2
// (the custom-guide catalogue) up front so it's fetched once regardless of
// how many assignments get evaluated against it.
func (a *App) newObligationEvaluator(r *http.Request) *obligationEvaluator {
	ev := &obligationEvaluator{
		ctx:    r.Context(),
		logger: a.ctxLogger(r.Context()),
	}
	lister, namespace, available, _ := a.resolveCustomGuideBackend(r)
	if !available {
		return ev
	}
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), customGuideAggregateDeadline)
	entries, _, err := drainCustomGuides(fetchCtx, namespace, lister, ev.logger)
	cancel()
	if err != nil {
		ev.logger.Info("custom guide catalogue unavailable for assignment evaluation", "error", err)
		return ev
	}
	ev.guides = entries
	ev.guidesOK = true
	return ev
}

// callerCompletionRecords is the caller's raw completion rows, via the same
// drain completion_records.go's cache uses, but skipping that cache's
// collation — met needs one row satisfying a whole criterion, and collation
// can merge latestCompletedAt/maxCompletionPercent from different rows. ok is
// false when the list could not be read; the caller then reports every
// obligation unmet rather than failing the assignment response.
func (a *App) callerCompletionRecords(r *http.Request, userID string) ([]completionRecordSpec, bool) {
	if shimCompletionRecords != nil {
		if records, _, handled := shimCompletionRecords(a, r); handled {
			out := make([]completionRecordSpec, len(records))
			for i, rec := range records {
				rec.UserID = userID
				out[i] = rec
			}
			return out, true
		}
	}
	lister, namespace, available, _ := a.resolveCompletionBackend(r)
	if !available {
		return nil, false
	}
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), completionAggregateDeadline)
	records, _, err := drainCompletionRecords(fetchCtx, namespace, lister, logger)
	cancel()
	if err != nil {
		logger.Info("completion records unavailable for assignment evaluation", "error", err)
		return nil, false
	}
	out := make([]completionRecordSpec, 0, len(records))
	for _, rec := range records {
		if rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, true
}

// satisfactionFunc is the adapter handleMyAssignments calls: builds one
// evaluator and one completion list for this request, then returns a closure
// so the GET handler applies satisfaction per assignment without knowing how
// any of it is resolved.
func (a *App) satisfactionFunc(r *http.Request, userID string) func(assignmentSpec) bool {
	logger := a.ctxLogger(r.Context())
	completions, ok := a.callerCompletionRecords(r, userID)
	var ev *obligationEvaluator
	if ok {
		ev = a.newObligationEvaluator(r)
	}
	return func(rec assignmentSpec) bool {
		if rec.TargetType == "guide" {
			logger.Error("assignment guide target is not evaluated", "targetType", rec.TargetType, "targetId", rec.TargetID)
			return false
		}
		if ev == nil {
			return false
		}
		return ev.met(rec, completions)
	}
}

// specFromEntry converts a wire-shaped assignmentEntry back into an
// assignmentSpec so satisfactionFunc's closure can evaluate it. Only the
// pathfinderdev fixture path needs this: its loader returns entries already
// wire-shaped, unlike the production path, which evaluates raw records
// directly (shapeAssignments in assignments.go).
func specFromEntry(entry assignmentEntry, userID string) assignmentSpec {
	return assignmentSpec{
		UserID:                userID,
		TargetType:            entry.TargetType,
		TargetID:              entry.TargetID,
		TrackID:               entry.TrackID,
		TargetSource:          entry.TargetSource,
		RuleID:                entry.RuleID,
		AssignedBy:            entry.AssignedBy,
		AssignedAt:            entry.AssignedAt,
		DueAt:                 entry.DueAt,
		AcceptCompletionsFrom: entry.AcceptCompletionsFrom,
		Lifecycle:             entry.Lifecycle,
	}
}

// writeSatisfiedAssignments is the other consumer of assignmentGuides/met:
// called from the completion write path, it re-evaluates every active,
// not-yet-satisfied assignment for this user and PATCHes status.satisfied on
// the ones the new completion newly meets (PATH_ASSIGNMENTS.md §6.12's status
// cache, for consumers that LIST the kind and can't join). A failure here
// does not fail the completion write: the next GET /assignments/my evaluates
// live regardless.
func (a *App) writeSatisfiedAssignments(r *http.Request, userID string, just completionRecordSpec) {
	lister, namespace, available, _ := a.resolveAssignmentBackend(r)
	if !available {
		return
	}
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), assignmentAggregateDeadline)
	records, _, err := drainAssignments(fetchCtx, namespace, lister, logger)
	cancel()
	if err != nil {
		logger.Info("assignment status write skipped", "error", err)
		return
	}
	writer, ok := lister.(assignmentStatusWriter)
	if !ok {
		return
	}
	completions, listOK := a.callerCompletionRecords(r, userID)
	if !listOK {
		completions = nil
	}
	fresh := true
	for _, rec := range completions {
		if rec.GuideID == just.GuideID && rec.GuideSource == just.GuideSource && rec.CompletedAt == just.CompletedAt {
			fresh = false
			break
		}
	}
	if fresh {
		completions = append(completions, just)
	}
	ev := a.newObligationEvaluator(r)
	for _, rec := range records {
		if rec.UserID != userID || rec.Lifecycle != assignmentLifecycleActive || rec.Name == "" {
			continue
		}
		if rec.StatusSatisfied != nil && *rec.StatusSatisfied {
			continue
		}
		res := ev.assignmentGuides(rec)
		if !res.resolved || !ev.met(rec, completions) {
			continue
		}
		listed := false
		for _, guideID := range res.guides {
			if guideID == just.GuideID {
				listed = true
				break
			}
		}
		if !listed {
			continue
		}
		if err := writer.UpdateStatus(r.Context(), namespace, rec.Name, true); err != nil {
			status, _ := upstreamStatusOf(err)
			logger.Info("assignment status write failed", "name", rec.Name, "status", status, "error", err)
		}
	}
}
