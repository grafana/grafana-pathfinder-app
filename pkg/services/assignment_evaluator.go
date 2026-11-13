package services

import (
	"context"
	"errors"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type PathGuideSource func(context.Context, string, string, string) ([]AssignmentGuideIdentity, bool, error)

type resolvedGuides struct {
	guides []AssignmentGuideIdentity
	err    error
}

// ObligationEvaluator serves one request: each target's guide list is resolved
// at most once across all assignments, failures included.
type ObligationEvaluator struct {
	Context  context.Context
	Logger   log.Logger
	Sources  []PathGuideSource
	resolved map[string]resolvedGuides
}

// Credit requires one raw row to meet identity, terminal percent and acceptance time together.
func (e *ObligationEvaluator) GuideProgress(asg Assignment, completions []CompletionRecord) ([]AssignmentGuideEntry, error) {
	guideIDs, err := e.AssignmentGuides(asg)
	if err != nil || len(guideIDs) == 0 {
		return nil, err
	}
	return AssignmentGuideProgress(asg, guideIDs, completions), nil
}

// A missing member identity makes the whole target unresolved, not partially satisfiable.
func (e *ObligationEvaluator) AssignmentGuides(asg Assignment) ([]AssignmentGuideIdentity, error) {
	if e.resolved == nil {
		e.resolved = map[string]resolvedGuides{}
	}
	key := asg.TargetType + "\x00" + asg.TargetID + "\x00" + asg.TrackID + "\x00" + asg.TargetSource
	if cached, ok := e.resolved[key]; ok {
		return cached.guides, cached.err
	}
	guides, err := e.resolveGuides(asg)
	seen := make(map[AssignmentGuideIdentity]bool, len(guides))
	unique := make([]AssignmentGuideIdentity, 0, len(guides))
	for _, guide := range guides {
		if guide.GuideID == "" || guide.GuideSource == "" {
			unique = nil
			break
		}
		if !seen[guide] {
			seen[guide] = true
			unique = append(unique, guide)
		}
	}
	guides = unique
	e.resolved[key] = resolvedGuides{guides: guides, err: err}
	return guides, err
}

// ErrAssignmentUncheckable means no source found the target and at least one
// failed, so the target may exist.
var ErrAssignmentUncheckable = errors.New("assignment target could not be checked")

// Source order is precedence: the first found target owns its membership, even if unresolved.
func (e *ObligationEvaluator) resolveGuides(asg Assignment) ([]AssignmentGuideIdentity, error) {
	if asg.TargetType == "guide" {
		if asg.TargetID == "" || asg.TargetSource == "" || asg.TrackID != "" {
			return nil, nil
		}
		return []AssignmentGuideIdentity{{GuideID: asg.TargetID, GuideSource: asg.TargetSource}}, nil
	}
	if asg.TargetType != "path" || asg.TargetID == "" {
		return nil, nil
	}
	failed := false
	for _, source := range e.Sources {
		guides, found, err := source(e.Context, asg.TargetID, asg.TrackID, asg.TargetSource)
		if err != nil {
			failed = true
			e.Logger.Info("assignment guide source failed", "targetId", asg.TargetID, "trackId", asg.TrackID, "error", err)
			continue
		}
		if found {
			return guides, nil
		}
	}
	if failed {
		return nil, ErrAssignmentUncheckable
	}
	return nil, nil
}
