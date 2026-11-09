package plugin

import (
	"net/http/httptest"
	"testing"
)

func captureLearningInsightsDefault(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	completion := rec("user:1", "bundled", "welcome-to-grafana", "Welcome to Grafana", "interactive", "", "objectives", "2026-09-15T12:00:00Z", 100)
	completion.UserLogin = "alex"
	completion.UserDisplayName = "Alex Example"
	withLister(t, singlePageLister(completion))
	assignment := asg("user:1", "welcome-to-grafana", "", "onboarding", "2026-09-01T00:00:00Z")
	assignment.Name = "onboarding-alex"
	assignment.TargetType = assignmentTargetGuide
	assignment.TargetSource = "bundled"
	withAssignmentLister(t, singlePageAssignmentLister(assignment))
	rr, _ := insightsResponse(t, insightsRequest(t, "Admin", "user:admin"))
	return rr
}

func captureLearningInsightsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	rr, _ := insightsResponse(t, insightsRequest(t, "Admin", ""))
	return rr
}
