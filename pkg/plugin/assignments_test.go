package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"
)

// fakeAssignmentLister is an injectable assignmentLister. respond maps an
// incoming continue token to a page or error; calls counts invocations.
// updateStatus is optional: nil means the lister does not implement
// assignmentStatusWriter at all (assignmentSatisfaction_test.go's satisfaction
// tests never need a status write), matching the resolveAssignmentBackend
// path most tests exercise.
type fakeAssignmentLister struct {
	respond      func(token string) (*assignmentPage, error)
	updateStatus func(ctx context.Context, namespace, name string, satisfied bool) error
	calls        int32
}

func (f *fakeAssignmentLister) ListPage(_ context.Context, _ string, token string) (*assignmentPage, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.respond(token)
}

func (f *fakeAssignmentLister) UpdateStatus(ctx context.Context, namespace, name string, satisfied bool) error {
	if f.updateStatus == nil {
		return fmt.Errorf("fakeAssignmentLister: UpdateStatus called with no updateStatus func set")
	}
	return f.updateStatus(ctx, namespace, name, satisfied)
}

func (f *fakeAssignmentLister) callCount() int { return int(atomic.LoadInt32(&f.calls)) }

// singlePageAssignmentLister serves all records in one page.
func singlePageAssignmentLister(records ...assignmentSpec) *fakeAssignmentLister {
	return &fakeAssignmentLister{respond: func(string) (*assignmentPage, error) {
		return &assignmentPage{Records: records, Continue: ""}, nil
	}}
}

func failingAssignmentLister(err error) *fakeAssignmentLister {
	return &fakeAssignmentLister{respond: func(string) (*assignmentPage, error) {
		return nil, err
	}}
}

func withAssignmentLister(t *testing.T, l assignmentLister) {
	t.Helper()
	prev := assignmentListerOverride
	assignmentListerOverride = l
	t.Cleanup(func() { assignmentListerOverride = prev })
}

// asg builds an active path assignment. Override lifecycle, target type, or
// the optional bounds on the returned value.
func asg(userID, targetID, trackID, ruleID, assignedAt string) assignmentSpec {
	return assignmentSpec{
		UserID:        userID,
		TargetType:    "path",
		TargetID:      targetID,
		TrackID:       trackID,
		RuleID:        ruleID,
		AssignedBy:    "l-and-d",
		AssignedAt:    assignedAt,
		Lifecycle:     assignmentLifecycleActive,
		SchemaVersion: 1,
	}
}

func doMyAssignments(t *testing.T, sub string) (*httptest.ResponseRecorder, myAssignmentsResponse) {
	t.Helper()
	return doMyAssignmentsReq(t, completionRequest(t, "/assignments/my", sub))
}

func doMyAssignmentsReq(t *testing.T, r *http.Request) (*httptest.ResponseRecorder, myAssignmentsResponse) {
	t.Helper()
	rr := httptest.NewRecorder()
	newTestApp(t).handleMyAssignments(rr, r)

	var resp myAssignmentsResponse
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode envelope: %v\nbody: %s", err, rr.Body.String())
		}
	}
	return rr, resp
}

func TestMyAssignments_ServesOnlyTheCallersSlice(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
		asg("user:2", "alerting-essentials", "", "oncall", "2026-09-13T09:00:00Z"),
	))

	_, resp := doMyAssignments(t, "user:1")

	if !resp.Capability.Available {
		t.Fatalf("capability = %+v, want available", resp.Capability)
	}
	if resp.UserID != "user:1" {
		t.Errorf("userId = %q, want user:1", resp.UserID)
	}
	if len(resp.Assignments) != 1 || resp.Assignments[0].TargetType != "path" || resp.Assignments[0].TargetID != "grafana-fundamentals" {
		t.Fatalf("assignments = %+v, want only the caller's", resp.Assignments)
	}
}

// A namespace LIST returns every subject's records (the accepted stack-scoped
// grain), so the caller filter is the only thing standing between one user and
// another's obligations on this route. An empty result must still serialize as
// [] — "unavailable" and "you have none" are different statements.
func TestMyAssignments_UnknownUserEmptyList(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
	))

	rr, resp := doMyAssignments(t, "user:nobody")

	if !resp.Capability.Available {
		t.Errorf("capability = %+v, want available (an empty slice is not unavailability)", resp.Capability)
	}
	if len(resp.Assignments) != 0 {
		t.Errorf("assignments = %+v, want empty", resp.Assignments)
	}
	if !strings.Contains(rr.Body.String(), `"assignments":[]`) {
		t.Errorf("body must carry an empty array, not null: %s", rr.Body.String())
	}
}

// MVP never writes `withdrawn`, but the field is real schema from day one and a
// future withdrawal action is a new caller of it. Filtering server-side means
// that action needs no frontend change to take effect.
func TestMyAssignments_DropsWithdrawnAndUnknownLifecycle(t *testing.T) {
	withdrawn := asg("user:1", "deprecated-onboarding", "", "retired", "2026-06-01T09:00:00Z")
	withdrawn.Lifecycle = "withdrawn"
	blank := asg("user:1", "unspecified-lifecycle", "", "malformed", "2026-06-02T09:00:00Z")
	blank.Lifecycle = ""

	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
		withdrawn,
		blank,
	))

	_, resp := doMyAssignments(t, "user:1")

	if len(resp.Assignments) != 1 || resp.Assignments[0].TargetID != "grafana-fundamentals" {
		t.Fatalf("assignments = %+v, want only the active one", resp.Assignments)
	}
}

// Every target type the caller holds is theirs. Selecting paths is a
// destination's job; this route must not drop a guide or invent "path" for
// a record whose targetType is absent.
func TestMyAssignments_ServesEveryTargetType(t *testing.T) {
	guide := asg("user:1", "github-visualize", "", "guide-lab", "2026-09-15T09:00:00Z")
	guide.TargetType = "guide"
	guide.TargetSource = "bundled"

	blank := asg("user:1", "missing-type", "", "malformed", "2026-09-13T09:00:00Z")
	blank.TargetType = ""

	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "seller", "new-joiners", "2026-09-14T09:00:00Z"),
		guide,
		blank,
	))

	_, resp := doMyAssignments(t, "user:1")

	if len(resp.Assignments) != 3 {
		t.Fatalf("assignments = %+v, want path, guide, and the blank type", resp.Assignments)
	}
	got := map[string]string{}
	for _, entry := range resp.Assignments {
		got[entry.TargetID] = entry.TargetType
	}
	if got["grafana-fundamentals"] != "path" || got["github-visualize"] != "guide" || got["missing-type"] != "" {
		t.Errorf("targets = %v, want each type preserved", got)
	}
	for _, entry := range resp.Assignments {
		if entry.TargetID == "grafana-fundamentals" && entry.TrackID != "seller" {
			t.Errorf("trackId = %q, want seller", entry.TrackID)
		}
	}
}

// A legacy pathId field is not the kind. Decoding must not treat it as a
// target, and the route must not default a missing targetType to path.
func TestAssignmentSpec_DecodesKindTargetNotPathID(t *testing.T) {
	const raw = `{
		"userId": "user:1",
		"targetType": "path",
		"targetId": "grafana-fundamentals",
		"trackId": "seller",
		"targetSource": "ignored-for-paths",
		"ruleId": "new-joiners",
		"ruleRevision": "abc123",
		"assignedBy": "l-and-d",
		"assignedAt": "2026-09-14T09:00:00Z",
		"dueAt": "2026-12-31T00:00:00Z",
		"acceptCompletionsFrom": "2026-01-01T00:00:00Z",
		"lifecycle": "active",
		"withdrawnAt": "",
		"schemaVersion": 1,
		"pathId": "not-a-field"
	}`

	var spec assignmentSpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		t.Fatalf("decode spec: %v", err)
	}
	if spec.TargetType != "path" || spec.TargetID != "grafana-fundamentals" {
		t.Fatalf("target = %q %q, want path grafana-fundamentals", spec.TargetType, spec.TargetID)
	}
	if spec.TrackID != "seller" || spec.RuleRevision != "abc123" || spec.SchemaVersion != 1 {
		t.Fatalf("spec = %+v, want the kind's optional scalars and schemaVersion", spec)
	}

	var legacy assignmentSpec
	if err := json.Unmarshal([]byte(`{"userId":"user:1","pathId":"grafana-fundamentals","lifecycle":"active"}`), &legacy); err != nil {
		t.Fatalf("decode legacy: %v", err)
	}
	if legacy.TargetType != "" || legacy.TargetID != "" {
		t.Fatalf("legacy pathId populated the target: %+v", legacy)
	}
}

// Two rules assigning the same path to one person produce two records, each
// with its own provenance and deadline. Nothing upstream merges them and this
// proxy must not either — collapsing them would discard a deadline the learner
// owes. Whether the UI renders one card or two is the component's call.
func TestMyAssignments_KeepsDuplicateTargetsFromDifferentRules(t *testing.T) {
	first := asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z")
	second := asg("user:1", "grafana-fundamentals", "", "annual-refresher", "2026-09-01T09:00:00Z")
	second.DueAt = "2026-12-31T00:00:00Z"

	withAssignmentLister(t, singlePageAssignmentLister(first, second))

	_, resp := doMyAssignments(t, "user:1")

	if len(resp.Assignments) != 2 {
		t.Fatalf("assignments = %+v, want both records", resp.Assignments)
	}
	if resp.Assignments[0].RuleID != "new-joiners" || resp.Assignments[1].RuleID != "annual-refresher" {
		t.Errorf("order = %q, %q; want newest assignedAt first",
			resp.Assignments[0].RuleID, resp.Assignments[1].RuleID)
	}
	if resp.Assignments[1].DueAt != "2026-12-31T00:00:00Z" {
		t.Errorf("dueAt = %q, want the second record's deadline preserved", resp.Assignments[1].DueAt)
	}
}

// Absent dueAt / acceptCompletionsFrom must stay OFF the wire, because absent
// is the statement "no deadline" / "any prior completion counts" that MVP
// makes. A reader treating them that way needs no change when the provisioner
// starts writing them.
func TestMyAssignments_AbsentTimeBoundsAreOmitted(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
	))

	rr, _ := doMyAssignments(t, "user:1")

	for _, field := range []string{"dueAt", "acceptCompletionsFrom", "trackId"} {
		if strings.Contains(rr.Body.String(), `"`+field+`"`) {
			t.Errorf("%s must be omitted when unset: %s", field, rr.Body.String())
		}
	}
	if !strings.Contains(rr.Body.String(), `"targetType":"path"`) || !strings.Contains(rr.Body.String(), `"targetId":"grafana-fundamentals"`) {
		t.Errorf("target type and id must be present: %s", rr.Body.String())
	}
	// satisfied and lifecycle are NOT omitempty: false and "" are meaningful
	// answers a client must be able to read, not absences.
	if !strings.Contains(rr.Body.String(), `"satisfied":false`) {
		t.Errorf("satisfied must always be present: %s", rr.Body.String())
	}
}

// With no completion list, every obligation stays unmet. Showing work as done
// when the join could not run would suppress it.
func TestMyAssignments_SatisfactionIsUnmetWithoutCompletions(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "security-awareness", "", "annual-compliance", "2026-07-01T09:00:00Z"),
	))

	_, resp := doMyAssignments(t, "user:1")

	if len(resp.Assignments) != 1 {
		t.Fatalf("assignments = %+v", resp.Assignments)
	}
	if resp.Assignments[0].Satisfied {
		t.Error("satisfied = true, but no completion list was available")
	}
}

func TestMyAssignments_DrainsEveryPage(t *testing.T) {
	pages := map[string]*assignmentPage{
		"": {
			Records:  []assignmentSpec{asg("user:1", "path-a", "", "rule-a", "2026-09-14T09:00:00Z")},
			Continue: "page-2",
		},
		"page-2": {
			Records:  []assignmentSpec{asg("user:1", "path-b", "", "rule-b", "2026-09-13T09:00:00Z")},
			Continue: "",
		},
	}
	lister := &fakeAssignmentLister{respond: func(token string) (*assignmentPage, error) {
		page, ok := pages[token]
		if !ok {
			t.Fatalf("unexpected continue token %q", token)
		}
		return page, nil
	}}
	withAssignmentLister(t, lister)

	_, resp := doMyAssignments(t, "user:1")

	if lister.callCount() != 2 {
		t.Errorf("LIST calls = %d, want 2 (a proxy that reads one page truncates silently)", lister.callCount())
	}
	if len(resp.Assignments) != 2 {
		t.Fatalf("assignments = %+v, want both pages", resp.Assignments)
	}
}

// There is deliberately no aggregate record cap: a cap would silently drop
// the caller's own record when it fell past the cut. This pins that a record
// on the LAST page of a long drain is still served — the drain must not stop
// early just because earlier pages held only other users' records.
func TestMyAssignments_ServesCallerRecordOnLastPage(t *testing.T) {
	pages := map[string]*assignmentPage{
		"": {
			Records:  []assignmentSpec{asg("user:2", "path-other-1", "", "rule-a", "2026-09-14T09:00:00Z")},
			Continue: "p2",
		},
		"p2": {
			Records:  []assignmentSpec{asg("user:3", "path-other-2", "", "rule-b", "2026-09-13T09:00:00Z")},
			Continue: "p3",
		},
		"p3": {
			Records:  []assignmentSpec{asg("user:1", "path-mine", "", "rule-c", "2026-09-12T09:00:00Z")},
			Continue: "",
		},
	}
	lister := &fakeAssignmentLister{respond: func(token string) (*assignmentPage, error) {
		page, ok := pages[token]
		if !ok {
			t.Fatalf("unexpected continue token %q", token)
		}
		return page, nil
	}}
	withAssignmentLister(t, lister)

	_, resp := doMyAssignments(t, "user:1")

	if lister.callCount() != 3 {
		t.Errorf("LIST calls = %d, want 3 (the whole namespace must be drained)", lister.callCount())
	}
	if len(resp.Assignments) != 1 || resp.Assignments[0].TargetID != "path-mine" {
		t.Fatalf("assignments = %+v, want only the caller's record from the last page", resp.Assignments)
	}
}

// Every identity failure is a soft-200 capability envelope carrying its own
// reason token, never a 401 and never a 503: none of them is retryable, and
// these routes gate whether a feature renders at all.
func TestMyAssignments_IdentityFailsClosedAsCapability(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:1", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
	))

	rr, resp := doMyAssignments(t, "")

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (a GET read signals identity failure in-band)", rr.Code)
	}
	if resp.Capability.Available {
		t.Error("capability available with no caller identity")
	}
	if resp.Capability.Reason != reasonIdentityUnavailable {
		t.Errorf("reason = %q, want %q", resp.Capability.Reason, reasonIdentityUnavailable)
	}
	if resp.UserID != "" {
		t.Errorf("userId = %q, want empty", resp.UserID)
	}
	if len(resp.Assignments) != 0 {
		t.Errorf("assignments = %+v, want none", resp.Assignments)
	}
}

// Warm-or-not, an unauthenticated caller reaches no upstream at all: the gate
// runs before the lister is even resolved.
func TestMyAssignments_IdentityGateRunsBeforeUpstream(t *testing.T) {
	lister := singlePageAssignmentLister()
	withAssignmentLister(t, lister)

	doMyAssignments(t, "")

	if lister.callCount() != 0 {
		t.Errorf("LIST calls = %d, want 0 before identity is verified", lister.callCount())
	}
}

func TestMyAssignments_StructuralUnavailability(t *testing.T) {
	cases := []struct {
		name       string
		cfg        map[string]string
		namespace  string
		wantReason string
	}{
		{
			name:       "aggregation toggle off",
			cfg:        map[string]string{sdkconfig.AppURL: testSigningKeysURL()},
			wantReason: reasonFeatureToggleDisabled,
		},
		{
			name: "no app URL",
			cfg: map[string]string{
				featuretoggles.EnabledFeatures: assignmentsAggregationToggle,
			},
			wantReason: reasonIdentityUnverifiable, // the identity gate needs it first
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withAssignmentLister(t, singlePageAssignmentLister())
			r := completionRequestWithConfig(t, "/assignments/my", "user:1", tc.cfg)
			rr, resp := doMyAssignmentsReq(t, r)

			if rr.Code != http.StatusOK {
				t.Errorf("status = %d, want 200", rr.Code)
			}
			if resp.Capability.Available {
				t.Error("capability available on a structurally unavailable stack")
			}
			if resp.Capability.Reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", resp.Capability.Reason, tc.wantReason)
			}
		})
	}
}

// A stack with no provisioned CAP token cannot authenticate as the caller at
// all — a "never works here" condition, not a hiccup. The override has to be
// cleared for this, since resolveAssignmentBackend applies it BEFORE the
// nil-exchanger guard so the structural path stays reachable in tests.
func TestMyAssignments_NoOBOCredentialIsStructural(t *testing.T) {
	withAssignmentLister(t, nil)

	_, resp := doMyAssignments(t, "user:1")

	if resp.Capability.Reason != reasonOBOUnavailable {
		t.Errorf("reason = %q, want %q", resp.Capability.Reason, reasonOBOUnavailable)
	}
}

// An unregistered Assignment kind is exactly this case today: the aggregator
// 404s a resource it does not serve. The status has to reach the envelope, or
// "the kind isn't deployed here" is indistinguishable from "your token was
// refused" without backend log access.
func TestMyAssignments_TerminalUpstreamCarriesStatusInReason(t *testing.T) {
	cases := map[int]string{
		http.StatusNotFound:  "upstream-404",
		http.StatusForbidden: "upstream-403",
	}

	for status, wantReason := range cases {
		t.Run(wantReason, func(t *testing.T) {
			withAssignmentLister(t, failingAssignmentLister(&appPlatformUpstreamError{status: status, msg: "nope"}))

			rr, resp := doMyAssignments(t, "user:1")

			if rr.Code != http.StatusOK {
				t.Errorf("status = %d, want 200 (a terminal upstream is a standing condition)", rr.Code)
			}
			if resp.Capability.Available {
				t.Error("capability available after a terminal upstream failure")
			}
			if resp.Capability.Reason != wantReason {
				t.Errorf("reason = %q, want %q", resp.Capability.Reason, wantReason)
			}
		})
	}
}

// Transient failures must NOT become capability=false: the frontend lumps 503
// into its not-rolled-out set and renders empty without retry, but it also
// caches capability=false for a TTL, so a blip served as a standing condition
// darkens the feature for longer than the blip lasted.
func TestMyAssignments_TransientUpstreamIs503WithRetryAfter(t *testing.T) {
	cases := map[string]error{
		"503 upstream": &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "boom"},
		"statusless":   errors.New("dial tcp: connection refused"),
	}

	for name, err := range cases {
		t.Run(name, func(t *testing.T) {
			withAssignmentLister(t, failingAssignmentLister(err))

			rr, _ := doMyAssignments(t, "user:1")

			if rr.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", rr.Code)
			}
			if rr.Header().Get("Retry-After") == "" {
				t.Error("expected Retry-After on a transient 503")
			}
			if !strings.Contains(rr.Body.String(), "assignments-unavailable") {
				t.Errorf("want a stable machine error token, got %s", rr.Body.String())
			}
		})
	}
}

func TestMyAssignments_RejectsNonGET(t *testing.T) {
	r, _ := http.NewRequest(http.MethodPost, "/assignments/my", nil)
	rr := httptest.NewRecorder()
	newTestApp(t).handleMyAssignments(rr, r)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rr.Code)
	}
}

// Assignments and completions must key on ONE subject vocabulary, verbatim and
// typed, or the future progress view becomes an identity reconciliation instead
// of a same-store query.
func TestMyAssignments_SubjectMatchesTheCompletionKey(t *testing.T) {
	withAssignmentLister(t, singlePageAssignmentLister(
		asg("user:abc123", "grafana-fundamentals", "", "new-joiners", "2026-09-14T09:00:00Z"),
	))
	r := completionRequest(t, "/assignments/my", "user:abc123")

	app := newTestApp(t)
	assignmentSubject, assignmentStatus := app.deriveAssignmentUserID(r)
	completionSubject, completionStatus := app.deriveCompletionUserID(r)

	if assignmentStatus != identityVerified || completionStatus != identityVerified {
		t.Fatalf("identity statuses = %v / %v, want verified", assignmentStatus, completionStatus)
	}
	if assignmentSubject != completionSubject {
		t.Errorf("assignment subject %q != completion subject %q", assignmentSubject, completionSubject)
	}
	if assignmentSubject != "user:abc123" {
		t.Errorf("subject = %q, want the typed prefix preserved verbatim", assignmentSubject)
	}
}

func TestAssignments_AggregationToggleMatchesTheServedGroup(t *testing.T) {
	if assignmentsAggregationToggle != completionRecordsAggregationToggle {
		t.Errorf("assignments toggle %q != completion records toggle %q; both surfaces are served on the same group",
			assignmentsAggregationToggle, completionRecordsAggregationToggle)
	}
	if want := "aggregation.pathfinderbackend-ext-grafana-app.enabled"; assignmentsAggregationToggle != want {
		t.Errorf("toggle = %q, want %q", assignmentsAggregationToggle, want)
	}
}
