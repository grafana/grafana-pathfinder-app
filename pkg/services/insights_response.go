package services

import (
	"sort"
	"time"
)

type AssignmentCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type LearningInsightsPerson struct {
	UserID          string `json:"userId"`
	UserLogin       string `json:"userLogin"`
	UserDisplayName string `json:"userDisplayName"`
}

type LearningInsightsCompletion struct {
	UserID      string `json:"userId"`
	GuideID     string `json:"guideId"`
	GuideSource string `json:"guideSource"`
	GuideTitle  string `json:"guideTitle"`
	CompletedAt string `json:"completedAt"`
	Source      string `json:"source"`
}

type LearningInsightsAssignment struct {
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
	Guides       []AssignmentGuideEntry `json:"guides"`
}

type LearningInsightsResponse struct {
	AsOf         string                       `json:"asOf"`
	From         string                       `json:"from"`
	To           string                       `json:"to"`
	Capability   AssignmentCapability         `json:"capability"`
	Completeness string                       `json:"completeness"`
	Warnings     []string                     `json:"warnings"`
	People       []LearningInsightsPerson     `json:"people"`
	Completions  []LearningInsightsCompletion `json:"completions"`
	Assignments  []LearningInsightsAssignment `json:"assignments"`
}

func NewLearningInsightsResponse(from, to time.Time) LearningInsightsResponse {
	return LearningInsightsResponse{From: from.Format(time.RFC3339Nano), To: to.Format(time.RFC3339Nano), Completeness: "complete", Warnings: []string{}, People: []LearningInsightsPerson{}, Completions: []LearningInsightsCompletion{}, Assignments: []LearningInsightsAssignment{}}
}

func (resp *LearningInsightsResponse) Partial(reason string) {
	resp.Completeness = "partial"
	for _, existing := range resp.Warnings {
		if existing == reason {
			return
		}
	}
	resp.Warnings = append(resp.Warnings, reason)
}

func ShapeLearningInsights(resp *LearningInsightsResponse, records []CompletionRecord, assignments []Assignment, from, to, now time.Time, historyComplete bool, progress func(Assignment, []CompletionRecord) ([]AssignmentGuideEntry, error)) {
	people := map[string]LearningInsightsPerson{}
	profileAt := map[string]time.Time{}
	byUser := map[string][]CompletionRecord{}
	terminal := map[string]LearningInsightsCompletion{}
	for _, rec := range records {
		if rec.UserID == "" {
			resp.Partial("invalid-completion-record")
			continue
		}
		person := people[rec.UserID]
		person.UserID = rec.UserID
		if rec.UserLogin != "" || rec.UserDisplayName != "" {
			at, _ := ParseCompletionTime(rec.RecordedAt)
			if prior, exists := profileAt[rec.UserID]; !exists || at.After(prior) {
				person.UserLogin, person.UserDisplayName = rec.UserLogin, rec.UserDisplayName
				profileAt[rec.UserID] = at
			}
		}
		people[rec.UserID] = person
		at, ok := ParseCompletionTime(rec.CompletedAt)
		if rec.CompletionPercent < 100 {
			continue
		}
		if !ok || rec.GuideID == "" || rec.GuideSource == "" {
			resp.Partial("invalid-completion-record")
			historyComplete = false
			continue
		}
		byUser[rec.UserID] = append(byUser[rec.UserID], rec)
		if rec.GuideCategory == "learning-journey" && (rec.PathID == "" || rec.PathID == rec.GuideID) {
			if !at.Before(from) && at.Before(to) {
				resp.Partial("journey-identity-ambiguous")
			}
			continue
		}
		if at.Before(from) || !at.Before(to) {
			continue
		}
		key := rec.UserID + "\x00" + rec.GuideSource + "\x00" + rec.GuideID
		previous, exists := terminal[key]
		prior, _ := ParseCompletionTime(previous.CompletedAt)
		if !exists || at.Before(prior) {
			terminal[key] = LearningInsightsCompletion{UserID: rec.UserID, GuideID: rec.GuideID, GuideSource: rec.GuideSource, GuideTitle: rec.GuideTitle, CompletedAt: at.UTC().Format(time.RFC3339Nano), Source: rec.Source}
		}
	}
	for _, rec := range assignments {
		if rec.UserID == "" {
			resp.Partial("invalid-assignment-record")
			continue
		}
		if _, exists := people[rec.UserID]; !exists {
			people[rec.UserID] = LearningInsightsPerson{UserID: rec.UserID}
		}
		entry := LearningInsightsAssignment{Name: rec.Name, UserID: rec.UserID, TargetType: rec.TargetType, TargetID: rec.TargetID, TargetSource: rec.TargetSource, TrackID: rec.TrackID, RuleID: rec.RuleID, AssignedAt: rec.AssignedAt, DueAt: rec.DueAt, Status: "unknown", Guides: []AssignmentGuideEntry{}}
		switch rec.Lifecycle {
		case "withdrawn":
			entry.Status = "withdrawn"
		case "active":
			guides, err := progress(rec, byUser[rec.UserID])
			if guides != nil {
				entry.Guides = guides
			}
			switch {
			case err != nil:
				entry.Reason = "target-fetch-failed"
			case len(guides) == 0:
				entry.Reason = "target-unresolved"
			case SatisfiedFromGuides(guides):
				entry.Status = "complete"
			case !historyComplete:
				entry.Reason = "completion-history-incomplete"
			default:
				entry.Status = "outstanding"
				if due, ok := ParseCompletionTime(rec.DueAt); ok && due.Before(now) {
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
