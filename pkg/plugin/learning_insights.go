package plugin

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	learningInsightsMaxPages = 20
	learningInsightsMaxItems = 10000
	learningInsightsDeadline = 30 * time.Second
)

type learningInsightsPerson struct {
	UserID          string `json:"userId"`
	UserLogin       string `json:"userLogin"`
	UserDisplayName string `json:"userDisplayName"`
}

type learningInsightsCompletion struct {
	UserID      string `json:"userId"`
	GuideID     string `json:"guideId"`
	GuideSource string `json:"guideSource"`
	GuideTitle  string `json:"guideTitle"`
	CompletedAt string `json:"completedAt"`
	Source      string `json:"source"`
}

type learningInsightsAssignment struct {
	Name         string                 `json:"name"`
	UserID       string                 `json:"userId"`
	TargetType   string                 `json:"targetType"`
	TargetID     string                 `json:"targetId"`
	TargetSource string                 `json:"targetSource"`
	TrackID      string                 `json:"trackId"`
	RuleID       string                 `json:"ruleId"`
	AssignedAt   string                 `json:"assignedAt"`
	DueAt        string                 `json:"dueAt"`
	Status       string                 `json:"status"`
	Reason       string                 `json:"reason"`
	Guides       []assignmentGuideEntry `json:"guides"`
}

type learningInsightsResponse struct {
	AsOf         string                       `json:"asOf"`
	From         string                       `json:"from"`
	To           string                       `json:"to"`
	Capability   assignmentCapability         `json:"capability"`
	Completeness string                       `json:"completeness"`
	Warnings     []string                     `json:"warnings"`
	People       []learningInsightsPerson     `json:"people"`
	Completions  []learningInsightsCompletion `json:"completions"`
	Assignments  []learningInsightsAssignment `json:"assignments"`
}

func newLearningInsightsResponse(from, to time.Time) learningInsightsResponse {
	return learningInsightsResponse{From: from.Format(time.RFC3339Nano), To: to.Format(time.RFC3339Nano), Completeness: "complete", Warnings: []string{}, People: []learningInsightsPerson{}, Completions: []learningInsightsCompletion{}, Assignments: []learningInsightsAssignment{}}
}

func (resp *learningInsightsResponse) partial(reason string) {
	resp.Completeness = "partial"
	for _, existing := range resp.Warnings {
		if existing == reason {
			return
		}
	}
	resp.Warnings = append(resp.Warnings, reason)
}

func learningInsightsPeriod(r *http.Request) (time.Time, time.Time, error) {
	now := timeNow().UTC()
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := to.AddDate(0, 0, -28)
	var err error
	if raw := r.URL.Query().Get("from"); raw != "" {
		from, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return from, to, err
		}
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		to, err = time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return from, to, err
		}
	}
	if !from.Before(to) {
		return from, to, errors.New("invalid period")
	}
	return from.UTC(), to.UTC(), nil
}

func (a *App) handleLearningInsights(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// User.Role is Grafana's current-org role in the trusted RPC context, never a browser header.
	pc := backend.PluginConfigFromContext(r.Context())
	if pc.User == nil || pc.User.Role != "Admin" {
		a.writeError(w, "learning-insights-forbidden", http.StatusForbidden)
		return
	}
	from, to, err := learningInsightsPeriod(r)
	if err != nil {
		a.writeError(w, "invalid-period", http.StatusBadRequest)
		return
	}
	resp := newLearningInsightsResponse(from, to)
	userID, status := a.subjectFromIDToken(r)
	if status != identityVerified {
		resp.Capability.Reason = status.capabilityReason()
		a.writeJSON(w, resp, http.StatusOK)
		return
	}
	if a.assignmentsReadRateLimiter != nil {
		if allow, retryAfter := a.assignmentsReadRateLimiter.allow(userID); !allow {
			a.writeRateLimited(w, retryAfter)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), learningInsightsDeadline)
	defer cancel()
	r = r.WithContext(ctx)
	completionLister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		resp.Capability.Reason = reason
		a.writeJSON(w, resp, http.StatusOK)
		return
	}
	resp.Capability.Available = true
	records, completionsComplete, warning := drainInsights(ctx, func(token string) ([]completionRecordSpec, string, error) {
		page, err := completionLister.ListPage(ctx, namespace, token)
		if err != nil {
			return nil, "", err
		}
		return page.Records, page.Continue, nil
	})
	if warning != "" {
		resp.partial("completions-" + warning)
	}
	assignments := []assignmentSpec{}
	lister, assignmentNamespace, available, reason := a.resolveAssignmentBackend(r)
	if !available {
		resp.partial("assignments-" + reason)
	} else if assignmentNamespace != namespace {
		resp.partial("assignments-namespace-mismatch")
	} else {
		var asgWarning string
		assignments, _, asgWarning = drainInsights(ctx, func(token string) ([]assignmentSpec, string, error) {
			page, err := lister.ListPage(ctx, namespace, token)
			if err != nil {
				return nil, "", err
			}
			return page.Records, page.Continue, nil
		})
		if asgWarning != "" {
			resp.partial("assignments-" + asgWarning)
		}
	}
	ev := a.insightsObligationEvaluator(r)
	shapeLearningInsights(&resp, records, assignments, from, to, timeNow().UTC(), completionsComplete, func(rec assignmentSpec, history []completionRecordSpec) ([]assignmentGuideEntry, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return ev.guideProgress(rec, history)
	})
	if ctx.Err() != nil {
		resp.partial("evaluation-deadline")
	}
	resp.AsOf = timeNow().UTC().Format(time.RFC3339Nano)
	a.ctxLogger(r.Context()).Debug("learning insights served", "namespace", namespace, "completionRecords", len(records), "assignmentRecords", len(assignments), "completeness", resp.Completeness, "warnings", resp.Warnings)
	a.writeJSON(w, resp, http.StatusOK)
}

// The shared client caps each page at 8 MiB: at most 160 MiB per kind is read, with 10k retained rows.
func drainInsights[T any](ctx context.Context, page func(string) ([]T, string, error)) ([]T, bool, string) {
	out := []T{}
	token := ""
	seen := map[string]bool{}
	for n := 0; n < learningInsightsMaxPages; n++ {
		if ctx.Err() != nil {
			return out, false, "deadline"
		}
		rows, next, err := page(token)
		if err != nil {
			if ctx.Err() != nil {
				return out, false, "deadline"
			}
			if isTerminalUpstreamError(err) {
				return out, false, "unsupported"
			}
			return out, false, "fetch-failed"
		}
		remaining := learningInsightsMaxItems - len(out)
		if len(rows) > remaining {
			return append(out, rows[:remaining]...), false, "item-limit"
		}
		out = append(out, rows...)
		if next == "" {
			return out, true, ""
		}
		if len(out) == learningInsightsMaxItems {
			return out, false, "item-limit"
		}
		if seen[next] {
			return out, false, "pagination-cycle"
		}
		seen[next], token = true, next
	}
	return out, false, "page-limit"
}

func shapeLearningInsights(resp *learningInsightsResponse, records []completionRecordSpec, assignments []assignmentSpec, from, to, now time.Time, historyComplete bool, progress func(assignmentSpec, []completionRecordSpec) ([]assignmentGuideEntry, error)) {
	people := map[string]learningInsightsPerson{}
	profileAt := map[string]time.Time{}
	byUser := map[string][]completionRecordSpec{}
	terminal := map[string]learningInsightsCompletion{}
	for _, rec := range records {
		if rec.UserID == "" {
			resp.partial("invalid-completion-record")
			continue
		}
		person := people[rec.UserID]
		person.UserID = rec.UserID
		if rec.UserLogin != "" || rec.UserDisplayName != "" {
			at, _ := parseCompletionTime(rec.RecordedAt)
			if prior, exists := profileAt[rec.UserID]; !exists || at.After(prior) {
				person.UserLogin, person.UserDisplayName = rec.UserLogin, rec.UserDisplayName
				profileAt[rec.UserID] = at
			}
		}
		people[rec.UserID] = person
		at, ok := parseCompletionTime(rec.CompletedAt)
		if rec.CompletionPercent < 100 {
			continue
		}
		if !ok || rec.GuideID == "" || rec.GuideSource == "" {
			resp.partial("invalid-completion-record")
			historyComplete = false
			continue
		}
		if rec.GuideCategory == "learning-journey" && (rec.PathID == "" || rec.PathID == rec.GuideID) {
			// An ambiguous row is unusable evidence, not a gap in the namespace LIST.
			if !at.Before(from) && at.Before(to) {
				resp.partial("journey-identity-ambiguous")
			}
			continue
		}
		byUser[rec.UserID] = append(byUser[rec.UserID], rec)
		if at.Before(from) || !at.Before(to) {
			continue
		}
		key := rec.UserID + "\x00" + rec.GuideSource + "\x00" + rec.GuideID
		previous, exists := terminal[key]
		prior, _ := parseCompletionTime(previous.CompletedAt)
		if !exists || at.Before(prior) {
			terminal[key] = learningInsightsCompletion{UserID: rec.UserID, GuideID: rec.GuideID, GuideSource: rec.GuideSource, GuideTitle: rec.GuideTitle, CompletedAt: at.UTC().Format(time.RFC3339Nano), Source: rec.Source}
		}
	}
	for _, rec := range assignments {
		if rec.UserID == "" {
			resp.partial("invalid-assignment-record")
			continue
		}
		if _, exists := people[rec.UserID]; !exists {
			people[rec.UserID] = learningInsightsPerson{UserID: rec.UserID}
		}
		entry := learningInsightsAssignment{Name: rec.Name, UserID: rec.UserID, TargetType: rec.TargetType, TargetID: rec.TargetID, TargetSource: rec.TargetSource, TrackID: rec.TrackID, RuleID: rec.RuleID, AssignedAt: rec.AssignedAt, DueAt: rec.DueAt, Status: "unknown", Guides: []assignmentGuideEntry{}}
		switch rec.Lifecycle {
		case "withdrawn":
			entry.Status = "withdrawn"
		case assignmentLifecycleActive:
			guides, err := progress(rec, byUser[rec.UserID])
			if guides != nil {
				entry.Guides = guides
			}
			switch {
			case err != nil:
				entry.Reason = "target-fetch-failed"
			case len(guides) == 0:
				entry.Reason = "target-unresolved"
			case satisfiedFromGuides(guides):
				entry.Status = "complete"
			case !historyComplete:
				entry.Reason = "completion-history-incomplete"
			default:
				entry.Status = "outstanding"
				if due, ok := parseCompletionTime(rec.DueAt); ok && due.Before(now) {
					entry.Status = "overdue"
				}
			}
		default:
			entry.Reason = "lifecycle-unsupported"
		}
		resp.Assignments = append(resp.Assignments, entry)
	}
	for _, p := range people {
		resp.People = append(resp.People, p)
	}
	for _, c := range terminal {
		resp.Completions = append(resp.Completions, c)
	}
	sort.Slice(resp.People, func(i, j int) bool { return resp.People[i].UserID < resp.People[j].UserID })
	sort.Slice(resp.Completions, func(i, j int) bool {
		x, y := resp.Completions[i], resp.Completions[j]
		if x.CompletedAt != y.CompletedAt {
			return x.CompletedAt < y.CompletedAt
		}
		if x.UserID != y.UserID {
			return x.UserID < y.UserID
		}
		if x.GuideSource != y.GuideSource {
			return x.GuideSource < y.GuideSource
		}
		return x.GuideID < y.GuideID
	})
	sort.Slice(resp.Assignments, func(i, j int) bool {
		x, y := resp.Assignments[i], resp.Assignments[j]
		if x.UserID != y.UserID {
			return x.UserID < y.UserID
		}
		if x.Name != y.Name {
			return x.Name < y.Name
		}
		if x.TargetID != y.TargetID {
			return x.TargetID < y.TargetID
		}
		return x.RuleID < y.RuleID
	})
}
