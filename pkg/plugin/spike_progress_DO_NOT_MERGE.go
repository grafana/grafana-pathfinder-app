// DO NOT MERGE — incremental-progress feasibility spike. See SPIKE.md.

package plugin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// Throwaway resource routes that exercise GET / PUT / merge-PATCH / DELETE on
// CompletionRecords through the plugin's real OBO path, as the calling Viewer,
// and return a redacted JSON report. See SPIKE.md. Not a production path.
//
//   GET  /spike/progress                                  preflight, no apiserver calls
//   POST /spike/progress/run?confirm=spike-progress-writes run the checks

// Timing: a run is bounded by spikeProgressDeadline for the leftover pre-check
// and the check sequence, PLUS up to spikeCleanupTimeout of cleanup on a
// context detached from that deadline, so a run can take up to ~90s end to end.
//
// spikeCreationSkew: an ambiguous create's record may be auto-deleted only if
// its creationTimestamp is no earlier than run start minus this skew.
const (
	spikeProgressConfirm  = "spike-progress-writes"
	spikeProgressDeadline = 60 * time.Second
	spikeCleanupTimeout   = 30 * time.Second
	spikeCreationSkew     = 5 * time.Second
	spikeRunCapPerUser    = 5
	spikeLeftoverListMax  = 20
	spikeUserSubPrefix    = "user:"
	spikeTimestampGap     = 1100 * time.Millisecond // timestamps have 1s granularity
	spikeMaxBytes         = 256 * 1024
	spikeNamePrefix       = "spike-progress-"
	spikeLabelKey         = "pathfinder.grafana.app/spike"
	spikeLabelValue       = "progress"
	spikeGuideSource      = "spike"
	spikeMergePatchType   = "application/merge-patch+json"
	spikeRequiredRole     = "Viewer"
)

var (
	// spikeProgressExpiry hard-stops the kit if this branch lingers on a stack.
	spikeProgressExpiry = time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)

	// spikeMinterOverride is a test seam; production uses a.oboExchanger.
	spikeMinterOverride accessTokenMinter

	// spikeProgressMu allows one run at a time per plugin process.
	spikeProgressMu sync.Mutex

	// spikeRunCounts counts runs per plugin instance, keyed by verified sub.
	// Guarded by spikeProgressMu.
	spikeRunCounts = map[*App]map[string]int{}

	// spikeProgressSleep is overridable so tests don't wait.
	spikeProgressSleep = func(ctx context.Context, d time.Duration) {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
		case <-t.C:
		}
	}
)

func (a *App) registerSpikeProgressRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/spike/progress", a.handleSpikeProgressPreflight)
	mux.HandleFunc("/spike/progress/run", a.handleSpikeProgressRun)
}

func (a *App) spikeMinter() (accessTokenMinter, string) {
	if spikeMinterOverride != nil {
		return spikeMinterOverride, "override"
	}
	if a.oboExchanger != nil {
		return a.oboExchanger, "obo-exchanger"
	}
	return nil, "none"
}

func spikeIdentityStatusName(s identityStatus) string {
	switch s {
	case identityVerified:
		return "verified"
	case identityRejected:
		return "rejected"
	case identityUnverifiable:
		return "unverifiable"
	case identitySigningKeysDown:
		return "signing-keys-down"
	default:
		return "unknown"
	}
}

func spikeIdentityOf(r *http.Request, sub, login, name string, status identityStatus, red *spikeRedactor) spikeIdentity {
	pc := backend.PluginConfigFromContext(r.Context())
	id := spikeIdentity{
		Status:           spikeIdentityStatusName(status),
		Reason:           status.capabilityReason(),
		Sub:              red.str(sub),
		Login:            red.str(login),
		Name:             red.str(name),
		IDTokenForwarded: strings.TrimSpace(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)) != "",
		OrgID:            pc.OrgID, //nolint:staticcheck // numeric orgId, as buildCompletionSpec
	}
	if pc.User != nil {
		id.PluginUserLogin = red.str(pc.User.Login)
		id.Role = pc.User.Role
	}
	return id
}

func spikeExpired() bool { return !timeNow().Before(spikeProgressExpiry) }

// spikeNewRedactor builds the redactor for a request: exact secrets, plus the
// app URL and token-exchange URL (and their hosts), which become "[upstream]".
func spikeNewRedactor(appURL string, secrets ...string) *spikeRedactor {
	red := &spikeRedactor{}
	for _, s := range secrets {
		red.addSecret(s)
	}
	red.addUpstream(appURL)
	red.addUpstream(tokenExchangeURL)
	return red
}

// spikeErrString unwraps a *url.Error (which embeds the full request URL) to
// its inner error, then redacts.
func spikeErrString(err error, red *spikeRedactor) string {
	if err == nil {
		return ""
	}
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		err = ue.Err
	}
	return red.str(err.Error())
}

// --- Preflight ---------------------------------------------------------------

type spikePreflightReport struct {
	Banner       string        `json:"banner"`
	Expires      string        `json:"expires"`
	Identity     spikeIdentity `json:"identity"`
	RoleIsViewer bool          `json:"roleIsViewer"`
	SubIsUser    bool          `json:"subIsUser"`
	Config       struct {
		Available    bool   `json:"available"`
		Reason       string `json:"reason,omitempty"`
		Namespace    string `json:"namespace,omitempty"`
		GroupVersion string `json:"groupVersion"`
		Resource     string `json:"resource"`
	} `json:"config"`
	OBOProvisioned bool   `json:"oboProvisioned"`
	MinterSource   string `json:"minterSource"`
	Mint           struct {
		Attempted     bool   `json:"attempted"`
		OK            bool   `json:"ok"`
		Error         string `json:"error,omitempty"`
		SkippedReason string `json:"skippedReason,omitempty"`
	} `json:"mint"`
	Ready bool `json:"ready"`
}

func (a *App) handleSpikeProgressPreflight(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if spikeExpired() {
		a.writeError(w, "spike-expired", http.StatusGone)
		return
	}

	appURL, namespace, idToken, available, reason := a.resolveCompletionConfig(r)
	red := spikeNewRedactor(appURL, r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))

	rep := spikePreflightReport{Banner: spikeBanner, Expires: spikeProgressExpiry.Format(time.RFC3339)}
	sub, login, name, status := a.completionWriterIdentity(r)
	rep.Identity = spikeIdentityOf(r, sub, login, name, status, red)
	rep.RoleIsViewer = rep.Identity.Role == spikeRequiredRole
	rep.SubIsUser = strings.HasPrefix(sub, spikeUserSubPrefix)

	rep.Config.Available = available
	rep.Config.Reason = reason
	rep.Config.Namespace = namespace
	rep.Config.GroupVersion = completionRecordsGroupVersion
	rep.Config.Resource = completionRecordsResource

	rep.OBOProvisioned = a.oboExchanger != nil
	minter, source := a.spikeMinter()
	rep.MinterSource = source
	switch {
	case minter == nil:
		rep.Mint.SkippedReason = reasonOBOUnavailable
	case status != identityVerified:
		rep.Mint.SkippedReason = "identity not verified"
	case !available:
		rep.Mint.SkippedReason = "config unavailable: " + reason
	default:
		rep.Mint.Attempted = true
		ctx, cancel := context.WithTimeout(r.Context(), appPlatformUpstreamTimeout)
		token, err := mintAccessToken(ctx, minter, namespace, idToken)
		cancel()
		red.addSecret(token)
		if err != nil {
			rep.Mint.Error = spikeErrString(err, red)
		} else {
			rep.Mint.OK = true
		}
	}
	rep.Ready = status == identityVerified && rep.SubIsUser && rep.RoleIsViewer && available && rep.Mint.OK
	a.writeJSON(w, rep, http.StatusOK)
}

// --- Run ---------------------------------------------------------------------

func (a *App) handleSpikeProgressRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if spikeExpired() {
		a.writeError(w, "spike-expired", http.StatusGone)
		return
	}
	if r.URL.Query().Get("confirm") != spikeProgressConfirm {
		a.writeError(w, "missing confirm="+spikeProgressConfirm, http.StatusBadRequest)
		return
	}

	// Identity gate: same status mapping as handleCreateCompletionRecord.
	sub, login, name, status := a.completionWriterIdentity(r)
	//exhaustive:enforce
	switch status {
	case identityVerified:
	case identityUnverifiable, identitySigningKeysDown:
		a.writeProxyError(w, status.capabilityReason(), http.StatusNotFound, proxyGateDiagnostic("identity-unavailable", "completionrecords", "spike", "identity"))
		return
	case identityUnknown, identityRejected:
		a.writeProxyError(w, "unauthenticated", http.StatusUnauthorized, proxyGateDiagnostic("identity-unavailable", "completionrecords", "spike", "identity"))
		return
	default:
		a.writeProxyError(w, "unauthenticated", http.StatusUnauthorized, proxyGateDiagnostic("identity-unavailable", "completionrecords", "spike", "identity"))
		return
	}

	if !strings.HasPrefix(sub, spikeUserSubPrefix) {
		a.writeError(w, "spike must be run by a user identity (sub "+spikeUserSubPrefix+"…), not a service account", http.StatusForbidden)
		return
	}
	pc := backend.PluginConfigFromContext(r.Context())
	if pc.User == nil || pc.User.Role != spikeRequiredRole {
		a.writeError(w, "spike must be run by a Viewer", http.StatusForbidden)
		return
	}

	appURL, namespace, idToken, available, reason := a.resolveCompletionConfig(r)
	if !available {
		a.writeProxyError(w, reason, http.StatusNotFound, proxyGateDiagnostic("proxy-unavailable", "completionrecords", "spike", "configuration"))
		return
	}
	minter, _ := a.spikeMinter()
	if minter == nil {
		a.writeProxyError(w, reasonOBOUnavailable, http.StatusNotFound, proxyGateDiagnostic("proxy-unavailable", "completionrecords", "spike", "configuration"))
		return
	}

	if !spikeProgressMu.TryLock() {
		a.writeError(w, "spike-run-in-progress", http.StatusConflict)
		return
	}
	defer spikeProgressMu.Unlock()

	if spikeRunCounts[a] == nil {
		spikeRunCounts[a] = map[string]int{}
	}
	// Cap check here (no upstream call when capped); the increment happens
	// only after the leftover pre-check passes, below. spikeProgressMu is held
	// for the whole handler, so check and increment cannot race.
	if spikeRunCounts[a][sub] >= spikeRunCapPerUser {
		a.writeError(w, "spike-run-cap", http.StatusTooManyRequests)
		return
	}

	// Bounds the pre-check and the check sequence; cleanup runs detached for up
	// to a further spikeCleanupTimeout (~90s total).
	ctx, cancel := context.WithTimeout(r.Context(), spikeProgressDeadline)
	defer cancel()

	logger := a.ctxLogger(r.Context())
	s := &spikeRunner{
		appURL:      appURL,
		namespace:   namespace,
		idToken:     idToken,
		sub:         sub,
		login:       login,
		displayName: name,
		orgID:       pc.OrgID, //nolint:staticcheck // numeric orgId, as buildCompletionSpec
		minter:      minter,
		client:      newAppPlatformListClient(appURL, minter, idToken, logger).httpClient,
		logger:      logger,
		red:         spikeNewRedactor(appURL, idToken),
		headerVals:  map[string]map[string]bool{},
		collection:  buildAppPlatformURL(appURL, completionRecordsGroupVersion, namespace, completionRecordsResource),
	}
	s.rep = &spikeReport{
		Banner:   spikeBanner,
		Question: spikeQuestion,
		Expires:  spikeProgressExpiry.Format(time.RFC3339),
		Target:   spikeTarget{GroupVersion: completionRecordsGroupVersion, Resource: completionRecordsResource, Namespace: namespace},
		Identity: spikeIdentityOf(r, sub, login, name, status, s.red),
		Steps:    []*spikeStep{},
		Cleanup:  []spikeCleanupResult{},
	}
	if names, truncated := s.precheckLeftovers(ctx); len(names) > 0 {
		a.writeJSON(w, spikeLeftoversResponse{
			Error:     "spike-leftovers-exist",
			Banner:    spikeBanner,
			Leftovers: names,
			Truncated: truncated,
			Hint:      "remove these spike records first (SPIKE.md, Leftovers), then re-run",
		}, http.StatusConflict)
		return
	}
	// Refused attempts are not counted; only runs that proceed to create are.
	spikeRunCounts[a][sub]++
	a.writeJSON(w, s.run(ctx), http.StatusOK)
}

type spikeLeftoversResponse struct {
	Error     string   `json:"error"`
	Banner    string   `json:"banner"`
	Leftovers []string `json:"leftovers"`
	Truncated bool     `json:"truncated"`
	Hint      string   `json:"hint"`
}

// Create outcomes, which decide whether cleanup may delete a candidate.
const (
	spikeCreateNotSent   = "not-sent"  // no request reached the transport
	spikeCreateCreated   = "created"   // 2xx with a uid in the response
	spikeCreateAmbiguous = "ambiguous" // transport error/timeout, 5xx, or 2xx without a uid
	spikeCreateRejected  = "rejected"  // 409 or any other non-2xx, non-5xx status
)

type spikeCandidate struct {
	label        string // "a" | "b"
	name         string
	createSent   bool
	createStatus int
	createdUID   string // only from a 2xx create response
}

func (c *spikeCandidate) noteCreate(resp spikeResponse, obj map[string]any) {
	c.createSent = resp.sent
	c.createStatus = resp.status
	if spike2xx(resp.status) {
		c.createdUID = spikeMetaField(obj, "uid")
	}
}

func (c *spikeCandidate) createOutcome() string {
	switch {
	case !c.createSent:
		return spikeCreateNotSent
	case spike2xx(c.createStatus) && c.createdUID != "":
		return spikeCreateCreated
	case c.createStatus == 0, c.createStatus >= 500, spike2xx(c.createStatus):
		return spikeCreateAmbiguous
	default:
		return spikeCreateRejected
	}
}

type spikeRunner struct {
	appURL, namespace, idToken string
	sub, login, displayName    string
	orgID                      int64
	minter                     accessTokenMinter
	client                     *http.Client
	logger                     log.Logger
	red                        *spikeRedactor
	rep                        *spikeReport
	headerVals                 map[string]map[string]bool
	snaps                      []spikeNamedSnapshot
	collection                 string
	runID                      string
	runStart                   time.Time
	candidates                 []*spikeCandidate
	// wrote is set when a create returned 2xx or an ambiguous create's record
	// was found; only then is the completion read cache invalidated.
	wrote bool
}

func spikeRunID(now time.Time) string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return now.UTC().Format("20060102150405") + "-" + hex.EncodeToString(b)
}

func (s *spikeRunner) run(ctx context.Context) *spikeReport {
	now := timeNow()
	s.runStart = now
	s.runID = spikeRunID(now)
	s.rep.RunID = s.runID
	s.rep.StartedAt = now.UTC().Format(time.RFC3339)
	// Cleanup candidates are registered BEFORE any POST.
	s.candidates = []*spikeCandidate{
		{label: "a", name: spikeNamePrefix + s.runID + "-a"},
		{label: "b", name: spikeNamePrefix + s.runID + "-b"},
	}
	for _, c := range s.candidates {
		s.rep.Records = append(s.rep.Records, c.name)
	}

	func() {
		defer s.cleanup(context.WithoutCancel(ctx))
		s.sequence(ctx)
	}()
	if s.wrote {
		invalidateCompletionIndex(s.namespace)
	}

	s.rep.UpdateTimestamp = spikeTimestampFindings(s.snaps)
	s.rep.StorageSignals = spikeStorage(s.snaps, s.headerUnion())
	decision := spikeDecide(s.rep.Findings, s.rep.UpdateTimestamp)
	for i := range decision {
		decision[i] = s.red.str(decision[i])
	}
	s.rep.Decision = decision
	s.rep.FinishedAt = timeNow().UTC().Format(time.RFC3339)
	return s.rep
}

func (s *spikeRunner) objectURL(name string) string {
	return s.collection + "/" + url.PathEscape(name)
}

// --- HTTP --------------------------------------------------------------------

type spikeResponse struct {
	status      int
	contentType string
	header      http.Header
	body        []byte
	truncated   bool
	duration    time.Duration
	err         error
	sent        bool // the request was handed to the HTTP client
}

// do sends one request with a freshly minted OBO token. Every minted token is
// added to the redaction list.
func (s *spikeRunner) do(ctx context.Context, method, rawURL, contentType string, body []byte, maxBytes int64) spikeResponse {
	start := time.Now()
	token, err := mintAccessToken(ctx, s.minter, s.namespace, s.idToken)
	if err != nil {
		return spikeResponse{err: err, duration: time.Since(start)}
	}
	s.red.addSecret(token)

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
	if err != nil {
		return spikeResponse{err: err, duration: time.Since(start)}
	}
	req.Header.Set(auth.AccessTokenHeader, token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return spikeResponse{err: err, duration: time.Since(start), sent: true}
	}
	defer func() { _ = resp.Body.Close() }()
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	out := spikeResponse{status: resp.StatusCode, contentType: resp.Header.Get("Content-Type"), header: resp.Header, err: readErr, sent: true}
	if int64(len(data)) > maxBytes {
		data = data[:maxBytes]
		out.truncated = true
	}
	out.body = data
	out.duration = time.Since(start)
	return out
}

type spikeCall struct {
	check       string
	method      string
	url         string
	contentType string
	body        []byte
	summary     string
	expected    string
	want        []int
}

// call runs one request and records a minimised step. The decoded object is
// returned for the runner's own use and never placed in the report.
func (s *spikeRunner) call(ctx context.Context, c spikeCall) (*spikeStep, spikeResponse, map[string]any) {
	resp := s.do(ctx, c.method, c.url, c.contentType, c.body, spikeMaxBytes)
	step := &spikeStep{
		Check:       c.check,
		Method:      c.method,
		Path:        spikePathOf(c.url),
		BodySummary: c.summary,
		Status:      resp.status,
		DurationMs:  resp.duration.Milliseconds(),
		Expected:    c.expected,
	}
	if c.body != nil {
		step.RequestContentType = c.contentType
	}
	if resp.err != nil {
		step.Error = spikeErrString(resp.err, s.red)
	}
	var obj map[string]any
	if resp.status != 0 {
		step.Headers = s.allowedHeaders(resp.header)
		step.StatusBody, step.Meta, obj = spikeSummarize(resp.status, resp.contentType, resp.body, s.red)
		if resp.truncated {
			step.Note = fmt.Sprintf("response truncated at %d bytes", spikeMaxBytes)
		}
	}
	step.Verdict = spikeVerdict(resp.status, resp.status == 0, c.want)
	s.logger.Info("spike progress step", "check", c.check, "status", resp.status, "durationMs", step.DurationMs)
	s.rep.Steps = append(s.rep.Steps, step)
	return step, resp, obj
}

func (s *spikeRunner) skip(check, reason string) {
	s.rep.Steps = append(s.rep.Steps, &spikeStep{Check: check, Verdict: spikeSkipped, Note: reason})
}

func (s *spikeRunner) snap(label string, m *spikeMetaSnapshot) {
	if m != nil {
		s.snaps = append(s.snaps, spikeNamedSnapshot{Label: label, Meta: m})
	}
}

func spikePathOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.RequestURI()
}

func (s *spikeRunner) allowedHeaders(h http.Header) map[string]string {
	out := map[string]string{}
	for _, name := range spikeAllowedHeaders {
		vals := h.Values(name)
		if len(vals) == 0 {
			continue
		}
		v := s.red.str(strings.Join(vals, ", "))
		out[name] = v
		if s.headerVals[name] == nil {
			s.headerVals[name] = map[string]bool{}
		}
		s.headerVals[name][v] = true
	}
	return out
}

func (s *spikeRunner) headerUnion() map[string][]string {
	out := map[string][]string{}
	for name, vals := range s.headerVals {
		for v := range vals {
			out[name] = append(out[name], v)
		}
		sort.Strings(out[name])
	}
	return out
}

// --- Bodies ------------------------------------------------------------------

func spikeJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func spikeDeepCopy(v any) map[string]any {
	m, _ := spikeDecodeObject(spikeJSON(v))
	if m == nil {
		m = map[string]any{}
	}
	return m
}

func (s *spikeRunner) newObject(name string, now time.Time, omitCompletedAt bool) []byte {
	ts := now.UTC().Format(time.RFC3339)
	spec := spikeDeepCopy(completionRecordWriteSpec{
		GuideID:           "spike-progress",
		GuideSource:       spikeGuideSource,
		GuideTitle:        "Spike: incremental progress (auto-deleted)",
		PathID:            "",
		Source:            "manual",
		CompletedAt:       ts,
		DurationSeconds:   0,
		CompletionPercent: 10,
		GuideCategory:     "interactive",
		Platform:          "cloud",
		UserID:            s.sub,
		UserLogin:         boundedIdentityField(s.login, completionMaxDisplayLen),
		UserDisplayName:   boundedIdentityField(s.displayName, completionMaxDisplayLen),
		RecordedAt:        ts,
		OrgID:             s.orgID,
		StackNamespace:    s.namespace,
		SchemaVersion:     completionWriteSchemaVersion,
	})
	if omitCompletedAt {
		delete(spec, "completedAt")
	}
	return spikeJSON(map[string]any{
		"apiVersion": completionRecordsGroupVersion,
		"kind":       "CompletionRecord",
		"metadata": map[string]any{
			"name":      name,
			"namespace": s.namespace,
			"labels":    map[string]any{spikeLabelKey: spikeLabelValue},
		},
		"spec": spec,
	})
}

// spikeUpdateBody is the GET object minus managedFields, with the given
// resourceVersion, completionPercent and recordedAt.
func spikeUpdateBody(obj map[string]any, rv string, percent int, now time.Time) []byte {
	cp := spikeDeepCopy(obj)
	md, _ := cp["metadata"].(map[string]any)
	if md == nil {
		md = map[string]any{}
		cp["metadata"] = md
	}
	delete(md, "managedFields")
	md["resourceVersion"] = rv
	spec, _ := cp["spec"].(map[string]any)
	if spec == nil {
		spec = map[string]any{}
		cp["spec"] = spec
	}
	spec["completionPercent"] = percent
	spec["recordedAt"] = now.UTC().Format(time.RFC3339)
	return spikeJSON(cp)
}

func spikeMergePatchBody(rv string, percent int, now time.Time) []byte {
	return spikeJSON(map[string]any{
		"metadata": map[string]any{"resourceVersion": rv},
		"spec":     map[string]any{"completionPercent": percent, "recordedAt": now.UTC().Format(time.RFC3339)},
	})
}

// --- Sequence ----------------------------------------------------------------

func (s *spikeRunner) sequence(ctx context.Context) {
	f := &s.rep.Findings
	a := s.candidates[0]
	urlA := s.objectURL(a.name)

	// 1. create
	createStep, resp, obj := s.call(ctx, spikeCall{
		check: "create", method: http.MethodPost, url: s.collection, contentType: "application/json",
		body:     s.newObject(a.name, timeNow(), false),
		summary:  "full object A (17 spec fields, spike label), completionPercent=10",
		expected: "201 (or 200)", want: []int{http.StatusCreated, http.StatusOK},
	})
	f.CreateStatus = resp.status
	a.noteCreate(resp, obj)
	createOK := resp.status == http.StatusCreated || resp.status == http.StatusOK
	if spike2xx(resp.status) {
		s.wrote = true
	}
	if createOK {
		s.snap(spikeSnapAfterCreate, createStep.Meta)
	}

	// 2. check1: GET by name
	getStep, resp, obj := s.call(ctx, spikeCall{
		check: "check1-get", method: http.MethodGet, url: urlA,
		expected: "200", want: []int{http.StatusOK},
	})
	getOK := resp.status == http.StatusOK && getStep.Meta != nil
	if getOK {
		s.snap(spikeSnapAfterGet, getStep.Meta)
	}

	if createOK && getOK {
		s.updateChecks(ctx, urlA, spikeMetaField(obj, "resourceVersion"), obj)
	} else {
		f.DependentStepsSkipped = true
		f.OnList = "inconclusive"
		for _, c := range []string{"check2-put", "check2-verify", "check3-stale-put", "check4-merge-patch", "check4-verify", "check4b-stale-merge-patch", "check4b-verify", "check5c-list"} {
			s.skip(c, "skipped: create or check1 GET failed")
		}
	}

	s.notFoundChecks(ctx)
	s.missingCompletedAtCheck(ctx)
	// check7 (storage signals) is derived from the snapshots in run().
}

func (s *spikeRunner) updateChecks(ctx context.Context, urlA, rv1 string, current map[string]any) {
	f := &s.rep.Findings
	curRV := rv1

	spikeProgressSleep(ctx, spikeTimestampGap)

	// 3. check2: PUT with current resourceVersion
	_, resp, _ := s.call(ctx, spikeCall{
		check: "check2-put", method: http.MethodPut, url: urlA, contentType: "application/json",
		body:     spikeUpdateBody(current, rv1, 50, timeNow()),
		summary:  "GET object minus managedFields, resourceVersion=rv1, completionPercent=50, recordedAt=now",
		expected: "200", want: []int{http.StatusOK},
	})
	f.PutStatus = resp.status

	// 3v. verify PUT persisted
	vStep, vResp, vObj := s.call(ctx, spikeCall{
		check: "check2-verify", method: http.MethodGet, url: urlA,
		expected: "200 with completionPercent=50 and a new resourceVersion", want: []int{http.StatusOK},
	})
	if vResp.status == http.StatusOK {
		pct, _ := spikeSpecPercent(vObj)
		rv2 := spikeMetaField(vObj, "resourceVersion")
		f.PutPersisted = pct == 50 && rv2 != "" && rv2 != rv1
		vStep.Verdict = spikePassFail(f.PutPersisted)
		vStep.Note = fmt.Sprintf("completionPercent=%d, resourceVersion changed=%t", pct, rv2 != rv1)
		s.snap(spikeSnapAfterPut, vStep.Meta)
		if rv2 != "" {
			curRV = rv2
		}
		current = vObj
	}
	f.PutWorks = spike2xx(f.PutStatus) && f.PutPersisted

	// 4. check3: stale PUT
	if f.PutWorks {
		stStep, stResp, stObj := s.call(ctx, spikeCall{
			check: "check3-stale-put", method: http.MethodPut, url: urlA, contentType: "application/json",
			body:     spikeUpdateBody(current, rv1, 60, timeNow()),
			summary:  "object with stale resourceVersion=rv1, completionPercent=60",
			expected: "409 Conflict", want: []int{http.StatusConflict},
		})
		f.StalePutStatus = stResp.status
		f.StalePutConflicts = stResp.status == http.StatusConflict
		if spike2xx(stResp.status) {
			stStep.Note = "stale PUT accepted: optimistic concurrency NOT enforced"
			if rv := spikeMetaField(stObj, "resourceVersion"); rv != "" {
				curRV = rv
			}
		}
	} else {
		f.StalePutSkipped = true
		s.skip("check3-stale-put", "skipped: PUT did not work")
	}

	spikeProgressSleep(ctx, spikeTimestampGap)

	// 5. check4: merge-patch with current resourceVersion
	beforePatchRV := curRV
	_, pResp, _ := s.call(ctx, spikeCall{
		check: "check4-merge-patch", method: http.MethodPatch, url: urlA, contentType: spikeMergePatchType,
		body:     spikeMergePatchBody(curRV, 75, timeNow()),
		summary:  "merge-patch: metadata.resourceVersion=current, completionPercent=75, recordedAt=now",
		expected: "observe (2xx means merge-patch is allowed)",
	})
	f.MergePatchStatus = pResp.status

	// 5v. verify patch persisted
	pvStep, pvResp, pvObj := s.call(ctx, spikeCall{
		check: "check4-verify", method: http.MethodGet, url: urlA,
		expected: "200 with completionPercent=75 and a new resourceVersion", want: []int{http.StatusOK},
	})
	if pvResp.status == http.StatusOK {
		pct, _ := spikeSpecPercent(pvObj)
		rv := spikeMetaField(pvObj, "resourceVersion")
		f.MergePatchPersisted = pct == 75 && rv != "" && rv != beforePatchRV
		pvStep.Verdict = spikePassFail(f.MergePatchPersisted)
		pvStep.Note = fmt.Sprintf("completionPercent=%d, resourceVersion changed=%t", pct, rv != beforePatchRV)
		s.snap(spikeSnapAfterPatch, pvStep.Meta)
		if rv != "" {
			curRV = rv
		}
	}
	f.MergePatchWorks = spike2xx(f.MergePatchStatus) && f.MergePatchPersisted

	// 6. check4b: merge-patch with stale resourceVersion
	f.MergePatchStaleMeaningful = rv1 != curRV
	bStep, bResp, _ := s.call(ctx, spikeCall{
		check: "check4b-stale-merge-patch", method: http.MethodPatch, url: urlA, contentType: spikeMergePatchType,
		body:     spikeMergePatchBody(rv1, 80, timeNow()),
		summary:  "merge-patch: stale metadata.resourceVersion=rv1, completionPercent=80",
		expected: "observe (409 Conflict means the RV precondition is enforced)",
	})
	f.MergePatchStaleStatus = bResp.status
	f.MergePatchStaleConflicts = bResp.status == http.StatusConflict
	if !f.MergePatchStaleMeaningful {
		bStep.Note = "rv1 equals the current resourceVersion (no earlier update persisted), so this was not a stale precondition"
	}
	bvStep, bvResp, bvObj := s.call(ctx, spikeCall{
		check: "check4b-verify", method: http.MethodGet, url: urlA,
		expected: "200 with completionPercent != 80 (stale patch not persisted)", want: []int{http.StatusOK},
	})
	if bvResp.status == http.StatusOK {
		pct, _ := spikeSpecPercent(bvObj)
		f.MergePatchStalePersisted = pct == 80
		bvStep.Verdict = spikePassFail(!f.MergePatchStalePersisted)
		bvStep.Note = fmt.Sprintf("completionPercent=%d", pct)
	}

	// 7. check5c: LIST (filtered only — never an unfiltered scan)
	s.listCheck(ctx)
}

// precheckLeftovers LISTs spike-labelled records and returns the names of the
// CALLER's own spike records (spec.userId == sub AND name has spikeNamePrefix),
// capped. Other users' items and non-prefixed records are never reported, not
// even counted. Only the first page (limit 100) is read. A failed LIST is
// recorded and the run continues.
func (s *spikeRunner) precheckLeftovers(ctx context.Context) ([]string, bool) {
	q := url.Values{}
	q.Set("labelSelector", spikeLabelKey+"="+spikeLabelValue)
	q.Set("limit", "100")
	step, resp, obj := s.call(ctx, spikeCall{
		check: "check0-leftovers-list", method: http.MethodGet, url: s.collection + "?" + q.Encode(),
		summary:  "filtered LIST; only the caller's own leftover names are kept",
		expected: "200 with none of the caller's records", want: []int{http.StatusOK},
	})
	if resp.status != http.StatusOK {
		step.Note = "leftover pre-check LIST failed; continuing without it"
		return nil, false
	}
	items, _ := obj["items"].([]any)
	var names []string
	count, truncated := 0, false
	for _, it := range items {
		item, _ := it.(map[string]any)
		spec, _ := item["spec"].(map[string]any)
		if spikeString(spec["userId"]) != s.sub || !strings.HasPrefix(spikeMetaField(item, "name"), spikeNamePrefix) {
			continue
		}
		count++
		if len(names) >= spikeLeftoverListMax {
			truncated = true
			continue
		}
		names = append(names, s.red.str(spikeMetaField(item, "name")))
	}
	step.Note = fmt.Sprintf("callerLeftovers=%d", count)
	if spikeMetaField(obj, "continue") != "" {
		step.Note += "; detection is partial: more pages exist (metadata.continue set) and were not checked"
	}
	if count > 0 {
		step.Verdict = spikeFail
	}
	return names, truncated
}

func (s *spikeRunner) listCheck(ctx context.Context) {
	s.rep.Findings.OnList = "inconclusive"
	q := url.Values{}
	q.Set("labelSelector", spikeLabelKey+"="+spikeLabelValue)
	q.Set("limit", "50")
	if s.listFor(ctx, "check5c-list-labelselector", s.collection+"?"+q.Encode(), "found-via-labelSelector") {
		return
	}
	q = url.Values{}
	q.Set("fieldSelector", "metadata.name="+s.candidates[0].name)
	q.Set("limit", "1")
	s.listFor(ctx, "check5c-list-fieldselector", s.collection+"?"+q.Encode(), "found-via-fieldSelector")
}

// listFor extracts ONLY record A's metadata from a filtered LIST; other items
// are counted, never reported.
func (s *spikeRunner) listFor(ctx context.Context, check, u, outcome string) bool {
	step, resp, obj := s.call(ctx, spikeCall{
		check: check, method: http.MethodGet, url: u,
		summary:  "filtered LIST; only record A's metadata is extracted",
		expected: "200 list containing A", want: []int{http.StatusOK},
	})
	if resp.status != http.StatusOK {
		return false
	}
	items, _ := obj["items"].([]any)
	s.rep.Findings.ListItemsReturned = len(items)
	for _, it := range items {
		item, _ := it.(map[string]any)
		if spikeMetaField(item, "name") != s.candidates[0].name {
			continue
		}
		step.Meta = spikeMetaFrom(item, s.red)
		step.Note = fmt.Sprintf("itemsReturned=%d; record A found", len(items))
		s.snap(spikeSnapOnList, step.Meta)
		s.rep.Findings.OnList = outcome
		return true
	}
	step.Note = fmt.Sprintf("itemsReturned=%d; record A not found", len(items))
	step.Verdict = spikeFail
	return false
}

func (s *spikeRunner) notFoundChecks(ctx context.Context) {
	missing := spikeNamePrefix + s.runID + "-missing"
	a, _, _ := s.call(ctx, spikeCall{
		check: "check6a-missing-name", method: http.MethodGet, url: s.objectURL(missing),
		expected: "404 Status NotFound", want: []int{http.StatusNotFound},
	})
	b, _, _ := s.call(ctx, spikeCall{
		check: "check6b-unknown-resource", method: http.MethodGet,
		url:      buildAppPlatformURL(s.appURL, completionRecordsGroupVersion, s.namespace, "spikeprogressnonexistents") + "/x",
		expected: "404 (unserved route)", want: []int{http.StatusNotFound},
	})
	c, _, _ := s.call(ctx, spikeCall{
		check: "check6c-unknown-version", method: http.MethodGet,
		url:      buildAppPlatformURL(s.appURL, appPlatformGroup+"/v0spike", s.namespace, completionRecordsResource) + "/" + url.PathEscape(missing),
		expected: "404 (supplementary)", want: []int{http.StatusNotFound},
	})
	c.Note = "supplementary: unknown version under the same group"
	s.rep.Findings.NotFoundDistinguishable, s.rep.Findings.NotFoundDistinguishableReason =
		spikeDistinguishable(a.Status, a.StatusBody, b.Status, b.StatusBody)
}

func (s *spikeRunner) missingCompletedAtCheck(ctx context.Context) {
	f := &s.rep.Findings
	b := s.candidates[1]
	step, resp, obj := s.call(ctx, spikeCall{
		check: "check8-missing-completedAt", method: http.MethodPost, url: s.collection, contentType: "application/json",
		body:     s.newObject(b.name, timeNow(), true),
		summary:  "full object B with spec.completedAt omitted",
		expected: "422 Invalid (plan expectation; the actual result is the finding)", want: []int{http.StatusUnprocessableEntity},
	})
	f.Check8Status = resp.status
	b.noteCreate(resp, obj)
	if step.StatusBody != nil {
		f.Check8Reason = step.StatusBody.Reason
	}
	if spike2xx(resp.status) {
		step.Note = "SIGNIFICANT: the current CRD accepted a record without completedAt"
		s.wrote = true
	}
}

// --- Cleanup -----------------------------------------------------------------

func (s *spikeRunner) cleanup(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, spikeCleanupTimeout)
	defer cancel()
	for _, c := range s.candidates {
		res := s.cleanupOne(ctx, c)
		if c == s.candidates[0] {
			s.rep.Findings.DeleteWorks = res.Outcome == "deleted"
		}
		s.rep.Cleanup = append(s.rep.Cleanup, res)
	}
}

// spikeOwnershipProblem returns why a record must NOT be deleted, or "".
// A candidate may be deleted only if (a) its uid came from a 2xx create
// response and matches, or (b) the create was ambiguous and the record is the
// caller's (spec.userId == sub) and was created no earlier than run start
// minus spikeCreationSkew. A 409 or other 4xx create is never deleted.
func spikeOwnershipProblem(c *spikeCandidate, obj map[string]any, sub string, runStart time.Time) string {
	outcome := c.createOutcome()
	switch outcome {
	case spikeCreateRejected:
		return fmt.Sprintf("create returned status %d, so this run did not create the record; never auto-deleted", c.createStatus)
	case spikeCreateNotSent:
		return "create request was never sent, so this run did not create the record; never auto-deleted"
	}
	name := spikeMetaField(obj, "name")
	if !strings.HasPrefix(name, spikeNamePrefix) || name != c.name {
		return "name is not this run's spike name"
	}
	labels, _ := spikeMetaMap(obj)["labels"].(map[string]any)
	if spikeString(labels[spikeLabelKey]) != spikeLabelValue {
		return "spike label " + spikeLabelKey + "=" + spikeLabelValue + " is missing"
	}
	spec, _ := obj["spec"].(map[string]any)
	if spikeString(spec["guideSource"]) != spikeGuideSource {
		return `spec.guideSource is not "spike"`
	}
	uid := spikeMetaField(obj, "uid")
	if uid == "" {
		return "no uid to use as a delete precondition"
	}
	if outcome == spikeCreateCreated {
		if uid != c.createdUID {
			return "uid differs from the uid in this run's create response"
		}
		return ""
	}
	// Ambiguous create.
	if spikeString(spec["userId"]) != sub {
		return "create outcome was ambiguous and spec.userId is not the caller"
	}
	ct, err := time.Parse(time.RFC3339, spikeMetaField(obj, "creationTimestamp"))
	if err != nil {
		return "create outcome was ambiguous and creationTimestamp is missing or unparseable"
	}
	if ct.Before(runStart.Add(-spikeCreationSkew)) {
		return "create outcome was ambiguous and creationTimestamp predates this run"
	}
	return ""
}

func (s *spikeRunner) cleanupOne(ctx context.Context, c *spikeCandidate) spikeCleanupResult {
	res := spikeCleanupResult{Name: c.name, CreateOutcome: c.createOutcome()}
	u := s.objectURL(c.name)
	_, resp, obj := s.call(ctx, spikeCall{
		check: "cleanup-get-" + c.label, method: http.MethodGet, url: u,
		expected: "200 or 404", want: []int{http.StatusOK, http.StatusNotFound},
	})
	if res.CreateOutcome == spikeCreateAmbiguous && resp.status == http.StatusOK {
		s.wrote = true
	}
	switch {
	case resp.status == http.StatusNotFound:
		res.Outcome = "absent"
		return res
	case resp.status != http.StatusOK || obj == nil:
		res.Outcome = "leftover"
		res.Reason = fmt.Sprintf("cleanup GET returned status %d; ownership could not be verified", resp.status)
		return res
	}
	if reason := spikeOwnershipProblem(c, obj, s.sub, s.runStart); reason != "" {
		res.Outcome = "refused"
		res.Reason = reason
		return res
	}

	_, dResp, _ := s.call(ctx, spikeCall{
		check: "cleanup-delete-" + c.label, method: http.MethodDelete, url: u, contentType: "application/json",
		body: spikeJSON(map[string]any{
			"kind": "DeleteOptions", "apiVersion": "v1",
			"preconditions": map[string]any{"uid": spikeMetaField(obj, "uid")},
		}),
		summary:  "DeleteOptions with preconditions.uid",
		expected: "200 or 202", want: []int{http.StatusOK, http.StatusAccepted},
	})
	res.DeleteStatus = dResp.status
	_, vResp, _ := s.call(ctx, spikeCall{
		check: "cleanup-verify-" + c.label, method: http.MethodGet, url: u,
		expected: "404", want: []int{http.StatusNotFound},
	})
	if spike2xx(dResp.status) && vResp.status == http.StatusNotFound {
		res.Outcome = "deleted"
		return res
	}
	res.Outcome = "leftover"
	res.Reason = fmt.Sprintf("delete status %d; follow-up GET status %d", dResp.status, vResp.status)
	return res
}
