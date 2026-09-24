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
	"github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/src/learning-paths"
)

// Obligation evaluation for GET /assignments/my (PATH_ASSIGNMENTS.md §6.12,
// §7.4). One completion row has to meet a guide on its own; collateByUser
// keeps latestCompletedAt and maxCompletionPercent from different rows, so
// this join reads the raw specs instead.

const pathIndexTimeout = 10 * time.Second

// guideRef is one guide a path obligation requires. MVP evaluates paths only.
type guideRef struct {
	ID string
}

type bundledPath struct {
	ID     string   `json:"id"`
	URL    string   `json:"url"`
	Guides []string `json:"guides"`
}

type bundledCatalogue struct {
	Paths []bundledPath `json:"paths"`
}

var (
	catalogueOnce  sync.Once
	ossPaths       []bundledPath
	cloudPaths     []bundledPath
	catalogueErr   error
	pathIndexFetch = fetchPathIndexJSON
)

func loadCatalogues() ([]bundledPath, []bundledPath, error) {
	catalogueOnce.Do(func() {
		ossPaths, catalogueErr = decodeCatalogue(learningpaths.PathsJSON)
		if catalogueErr != nil {
			return
		}
		cloudPaths, catalogueErr = decodeCatalogue(learningpaths.PathsCloudJSON)
	})
	return ossPaths, cloudPaths, catalogueErr
}

func decodeCatalogue(raw []byte) ([]bundledPath, error) {
	var file bundledCatalogue
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, err
	}
	return file.Paths, nil
}

// useCloudCatalogue matches paths-data.ts. The boot setting wins when the
// plugin config carries it; otherwise the stack app URL is the Cloud signal
// this proxy already has.
func useCloudCatalogue(cfg *config.GrafanaCfg) bool {
	if cfg == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Get("cloudMigrationIsTarget"))) {
	case "true", "1":
		return true
	case "false", "0":
		return false
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		return false
	}
	u, err := url.Parse(appURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "grafana.net" || strings.HasSuffix(host, ".grafana.net") || strings.HasSuffix(host, ".grafana-dev.net")
}

// obligationEvaluator resolves a path to the guides that must be complete,
// then tests the caller's raw completion rows against that set. The kind also
// allows a guide target; MVP does not evaluate one.
type obligationEvaluator struct {
	ctx        context.Context
	logger     log.Logger
	cloud      bool
	guides     []customGuideRepositoryEntry
	guidesOK   bool
	guideLists map[string]guideList
}

// guideList is the guides one assignment requires. resolved is false when
// that list could not be determined; met treats that as unmet.
type guideList struct {
	guides   []guideRef
	resolved bool
}

func (e *obligationEvaluator) met(asg assignmentSpec, completions []completionRecordSpec) bool {
	res := e.guidesFor(asg)
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
	for _, guide := range res.guides {
		if !guideCompleted(guide, completions, accept, hasAccept) {
			return false
		}
	}
	return true
}

// guidesFor is the guides an assignment requires. A guide target is logged
// and left unresolved; MVP evaluates paths only. One evaluation reuses the
// first result for the same target.
func (e *obligationEvaluator) guidesFor(asg assignmentSpec) guideList {
	if e.guideLists == nil {
		e.guideLists = map[string]guideList{}
	}
	key := asg.TargetType + "\x00" + asg.TargetID + "\x00" + asg.TrackID + "\x00" + asg.TargetSource
	if res, ok := e.guideLists[key]; ok {
		return res
	}
	res := guideList{}
	switch asg.TargetType {
	case "guide":
		e.logger.Error("assignment guide target is not evaluated", "targetType", asg.TargetType, "targetId", asg.TargetID)
	case "path":
		res = e.pathGuides(asg)
	}
	e.guideLists[key] = res
	return res
}

// pathGuides is guidesFor for a path: the bundled catalogue, else a docs
// index, else a published custom path. A track stays unresolved; this
// process has no track manifest, and grading the whole path would mark a
// narrower obligation done.
func (e *obligationEvaluator) pathGuides(asg assignmentSpec) guideList {
	if asg.TrackID != "" || asg.TargetID == "" {
		return guideList{}
	}
	oss, cloud, err := loadCatalogues()
	if err != nil {
		e.logger.Info("bundled path catalogue unavailable", "error", err)
		return guideList{}
	}
	paths := oss
	if e.cloud {
		paths = cloud
	}
	for _, path := range paths {
		if path.ID != asg.TargetID {
			continue
		}
		if len(path.Guides) > 0 {
			return guideList{guides: guideIDs(path.Guides), resolved: true}
		}
		if path.URL == "" {
			return guideList{}
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
	if !e.guidesOK {
		return guideList{}
	}
	ids, ok := publishedPathGuides(e.guides, asg.TargetID)
	if !ok || len(ids) == 0 {
		return guideList{}
	}
	return guideList{guides: guideIDs(ids), resolved: true}
}

func guideIDs(ids []string) []guideRef {
	refs := make([]guideRef, 0, len(ids))
	for _, id := range ids {
		if id != "" {
			refs = append(refs, guideRef{ID: id})
		}
	}
	return refs
}

// publishedPathGuides is the custom-catalogue step of pathGuides, not another
// assignment lookup. It returns milestone ids: a published path or journey,
// and only milestones that are themselves published. ok is false when id is
// not such a path. pathGuides wraps the ids as guideRefs.
func publishedPathGuides(entries []customGuideRepositoryEntry, id string) ([]string, bool) {
	published := map[string]struct{}{}
	var match *customGuideRepositoryEntry
	for i := range entries {
		entry := &entries[i]
		if entry.Status != "published" {
			continue
		}
		published[entry.ID] = struct{}{}
		if entry.ID == id && entry.Manifest != nil && (entry.Manifest.Type == "path" || entry.Manifest.Type == "journey") {
			match = entry
		}
	}
	if match == nil {
		return nil, false
	}
	ids := make([]string, 0, len(match.Manifest.Milestones))
	for _, milestone := range match.Manifest.Milestones {
		if _, ok := published[milestone]; ok {
			ids = append(ids, milestone)
		}
	}
	return ids, true
}

func guideCompleted(guide guideRef, completions []completionRecordSpec, accept time.Time, hasAccept bool) bool {
	for _, rec := range completions {
		if rec.GuideID != guide.ID {
			continue
		}
		at, ok := parseCompletionTime(rec.CompletedAt)
		if !ok {
			continue
		}
		if hasAccept && at.Before(accept) {
			continue
		}
		return true
	}
	return false
}

// parsePathIndex reads a docs index.json the way fetch-path-guides.ts does:
// skip params.grafana.skip, guide id is the permalink slug.
func parsePathIndex(body []byte) ([]guideRef, error) {
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
	refs := make([]guideRef, 0, len(items))
	for _, item := range items {
		if item.Params.Grafana.Skip {
			continue
		}
		slug := slugFromPermalink(item.Relpermalink)
		if slug == "" {
			continue
		}
		refs = append(refs, guideRef{ID: slug})
	}
	return refs, nil
}

func slugFromPermalink(rel string) string {
	rel = strings.TrimRight(rel, "/")
	if rel == "" {
		return ""
	}
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[i+1:]
	}
	return rel
}

func indexJSONURL(pathURL string) (string, error) {
	if !strings.HasSuffix(pathURL, "/") {
		pathURL += "/"
	}
	u, err := url.Parse(pathURL)
	if err != nil {
		return "", err
	}
	if u.Scheme != "https" || u.Host == "" {
		return "", fmt.Errorf("path index url must be https")
	}
	u.Path += "index.json"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

var pathIndexClient = &http.Client{
	Timeout: pathIndexTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func fetchPathIndexJSON(ctx context.Context, pathURL string) ([]guideRef, error) {
	endpoint, err := indexJSONURL(pathURL)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, pathIndexTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
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
	return parsePathIndex(body)
}

func (a *App) newObligationEvaluator(r *http.Request) *obligationEvaluator {
	ev := &obligationEvaluator{
		ctx:    r.Context(),
		logger: a.ctxLogger(r.Context()),
		cloud:  useCloudCatalogue(config.GrafanaConfigFromContext(r.Context())),
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

// callerCompletionRecords is the caller's raw completion rows. ok is false
// when the list could not be read; the caller then reports every obligation
// unmet rather than failing the assignment response.
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

// writeSatisfiedAssignments sets status.satisfied on obligations this
// completion newly meets. A failure here does not fail the completion write:
// the next GET /assignments/my evaluates live.
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
	completions = appendFreshCompletion(completions, just)
	ev := a.newObligationEvaluator(r)
	for _, rec := range records {
		if rec.UserID != userID || rec.Lifecycle != assignmentLifecycleActive || rec.Name == "" {
			continue
		}
		if rec.StatusSatisfied != nil && *rec.StatusSatisfied {
			continue
		}
		res := ev.guidesFor(rec)
		if !res.resolved || !ev.met(rec, completions) {
			continue
		}
		listed := false
		for _, guide := range res.guides {
			if guide.ID == just.GuideID {
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

func appendFreshCompletion(records []completionRecordSpec, just completionRecordSpec) []completionRecordSpec {
	for _, rec := range records {
		if rec.GuideID == just.GuideID && rec.GuideSource == just.GuideSource && rec.CompletedAt == just.CompletedAt {
			return records
		}
	}
	return append(records, just)
}
