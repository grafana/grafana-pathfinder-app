package services

import (
	"github.com/grafana/grafana-pathfinder-app/src/constants"
	"time"
)

type AssignmentGuideIdentity struct {
	GuideID         string
	GuideSource     string
	AlternateSource string
}

func AssignmentGuideMatchesCompletion(guide AssignmentGuideIdentity, rec CompletionRecord) bool {
	if guide.GuideID != rec.GuideID {
		return false
	}
	if constants.IsBundledTutorial(guide.GuideID) && PublicTutorialSource(guide.GuideSource) && PublicTutorialSource(rec.GuideSource) {
		// Historical online first-dashboard records describe the RSS tutorial, not the migrated guide.
		return constants.LegacyOnlineTutorialID(guide.GuideID) == "" || rec.GuideSource == "bundled"
	}
	return guide.MatchesSource(rec.GuideSource)
}

func PublicTutorialSource(source string) bool {
	return source == "bundled" || source == "interactive-tutorials" || source == "online-cdn"
}

func (guide AssignmentGuideIdentity) MatchesSource(source string) bool {
	return source != "" && (guide.GuideSource == source || guide.AlternateSource == source)
}

func OnlineAssignmentGuide(id string) AssignmentGuideIdentity {
	// The CDN and recommender resolvers name the same public content differently.
	return AssignmentGuideIdentity{GuideID: id, GuideSource: "online-cdn", AlternateSource: "interactive-tutorials"}
}

func AssignmentGuideProgress(asg Assignment, guideIDs []AssignmentGuideIdentity, completions []CompletionRecord) []AssignmentGuideEntry {
	var accept time.Time
	hasAccept := false
	if asg.AcceptCompletionsFrom != "" {
		parsed, ok := ParseCompletionTime(asg.AcceptCompletionsFrom)
		if !ok {
			return nil
		}
		accept, hasAccept = parsed, true
	}
	entries := make([]AssignmentGuideEntry, len(guideIDs))
	for i, guideID := range guideIDs {
		done := false
		for _, rec := range completions {
			if !AssignmentGuideMatchesCompletion(guideID, rec) || rec.CompletionPercent < 100 {
				continue
			}
			at, ok := ParseCompletionTime(rec.CompletedAt)
			if !ok {
				continue
			}
			if hasAccept && at.Before(accept) {
				continue
			}
			done = true
			break
		}
		entries[i] = AssignmentGuideEntry{GuideID: guideID.GuideID, GuideSource: guideID.GuideSource, Completed: done}
	}
	return entries
}
