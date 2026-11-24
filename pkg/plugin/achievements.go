package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/authlib/types"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

// Achievements routes (RFC §6.5). The path version is set only here; the
// versioning approach (§6.8) is not settled.
const (
	achievementsAPIVersion  = "v1"
	achievementsRoutePrefix = "/api/" + achievementsAPIVersion + "/achievements"

	achievementEventsMaxBodyBytes = 4 * 1024

	achievementEventsRateBurst        = 30.0
	achievementEventsRateRefillPerSec = 0.5

	reasonPrincipalNotSupported = "principal-not-supported"
	errAchievementsUnavailable  = "achievements-unavailable"
)

// achievementsBackend is the persistence a request is served with. Both ports
// write and read as the caller, so an implementation is built per request.
type achievementsBackend struct {
	store  achievements.Store
	reader achievements.Reader
}

// achievementsBackendFor builds the backend for one request, as the person the
// handler verified. An empty reason means available; otherwise the reason is the
// capability token.
type achievementsBackendFor func(r *http.Request, person achievements.Person, catalog *achievements.Catalog) (achievementsBackend, string)

var errPrincipalNotSupported = errors.New("principal is not a person")

type rateLimitedError struct{ retryAfter time.Duration }

func (*rateLimitedError) Error() string { return "rate limited" }

// achievementPolicy is the Policy port. People only is enforced where a Person
// is made (personFromSubject), so only the limiter is left here.
type achievementPolicy struct{ limiter *userRateLimiter }

func (p achievementPolicy) Allow(_ context.Context, person achievements.Person) error {
	if p.limiter == nil {
		return nil
	}
	if allow, retryAfter := p.limiter.allow(person.ID); !allow {
		return &rateLimitedError{retryAfter: retryAfter}
	}
	return nil
}

// personFromSubject accepts only the user principal type. Service accounts, the
// render service, anonymous callers and the rest are refused.
func personFromSubject(sub string) (achievements.Person, error) {
	typ, _, err := types.ParseTypeID(sub)
	if err != nil || typ != types.TypeUser {
		return achievements.Person{}, errPrincipalNotSupported
	}
	return achievements.Person{ID: sub}, nil
}

type achievementEventsResponse = services.AchievementEventsResponse
type achievementCapability = services.AchievementCapability
type achievementAward = services.AchievementAward
type achievementProgress = services.AchievementProgress
type legacyBadge = services.LegacyBadge
type myAchievementsResponse = services.MyAchievementsResponse

// achievementsUnavailableReason applies the completion routes' structural gate.
// An empty reason means the routes may read the definitions and build a backend.
func (a *App) achievementsUnavailableReason(r *http.Request) string {
	if _, _, _, ok, reason := a.resolveCompletionConfig(r); !ok {
		return reason
	}
	if a.oboExchanger == nil {
		return reasonOBOUnavailable
	}
	if a.definitions == nil || a.achievementsBackendFor == nil {
		return reasonBackendUnavailable
	}
	return ""
}

// achievementPerson is the people-only gate of the events and definitions
// routes. On refusal it has written the answer.
func (a *App) achievementPerson(w http.ResponseWriter, r *http.Request, op string) (achievements.Person, bool) {
	sub, status := a.subjectFromIDToken(r)
	//exhaustive:enforce
	switch status {
	case identityVerified:
	case identityUnverifiable, identitySigningKeysDown:
		a.writeAchievementsUnavailable(w, status.capabilityReason(), op)
		return achievements.Person{}, false
	case identityUnknown, identityRejected:
		a.writeError(w, "unauthenticated", http.StatusUnauthorized)
		return achievements.Person{}, false
	default:
		a.writeError(w, "unauthenticated", http.StatusUnauthorized)
		return achievements.Person{}, false
	}

	person, err := personFromSubject(sub)
	if err != nil {
		a.writeError(w, reasonPrincipalNotSupported, http.StatusForbidden)
		return achievements.Person{}, false
	}
	return person, true
}

// handleAchievementEvent serves POST /api/v1/achievements/events.
func (a *App) handleAchievementEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	person, ok := a.achievementPerson(w, r, "create")
	if !ok {
		return
	}

	if reason := a.achievementsUnavailableReason(r); reason != "" {
		a.writeAchievementsUnavailable(w, reason, "create")
		return
	}
	defs, ok := a.achievementDefinitions(w, r)
	if !ok {
		return
	}
	backend, reason := a.achievementsBackendFor(r, person, defs.Catalog)
	if reason != "" {
		a.writeAchievementsUnavailable(w, reason, "create")
		return
	}

	req, err := decodeAchievementEvent(w, r)
	if err != nil {
		a.writeError(w, "invalid-event", http.StatusBadRequest)
		return
	}
	event, err := defs.Registry.NewEvent(req, timeNow())
	if errors.Is(err, achievements.ErrNotCounted) {
		a.writeJSON(w, achievementEventsResponse{EventID: req.EventID, Decisions: []achievements.Decision{}}, http.StatusOK)
		return
	}
	if err != nil {
		a.ctxLogger(r.Context()).Debug("achievement event rejected", "error", err)
		a.writeError(w, "invalid-event", http.StatusBadRequest)
		return
	}

	evaluator := achievements.NewEvaluator(defs.Catalog, backend.store, achievementPolicy{limiter: a.achievementEventsRateLimiter}, timeNow)
	decisions, err := evaluator.Evaluate(r.Context(), person, event)
	var limited *rateLimitedError
	if errors.As(err, &limited) {
		a.writeRateLimited(w, limited.retryAfter)
		return
	}
	if err != nil {
		a.ctxLogger(r.Context()).Warn("achievement evaluation failed", "error", err)
		a.writeError(w, "busy", http.StatusServiceUnavailable)
		return
	}

	a.writeJSON(w, achievementEventsResponse{
		EventID:   event.ID,
		Retry:     achievements.Retry(decisions),
		Decisions: decisions,
	}, http.StatusOK)
}

func decodeAchievementEvent(w http.ResponseWriter, r *http.Request) (achievements.EventRequest, error) {
	var req achievements.EventRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, achievementEventsMaxBodyBytes))
	if err := dec.Decode(&req); err != nil {
		return req, err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return req, errors.New("trailing data")
	}
	return req, nil
}

// handleMyAchievements serves GET /api/v1/achievements/my.
func (a *App) handleMyAchievements(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sub, status := a.subjectFromIDToken(r)
	if status != identityVerified {
		a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: status.capabilityReason()}})
		return
	}
	person, err := personFromSubject(sub)
	if err != nil {
		a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reasonPrincipalNotSupported}})
		return
	}

	if reason := a.achievementsUnavailableReason(r); reason != "" {
		a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reason}})
		return
	}
	defs, ok := a.achievementDefinitions(w, r)
	if !ok {
		return
	}
	backend, reason := a.achievementsBackendFor(r, person, defs.Catalog)
	if reason != "" {
		a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reason}})
		return
	}

	rows, err := backend.reader.ListMine(r.Context(), person)
	if err != nil {
		if errors.Is(err, errAchievementRowMismatch) {
			// A retry reads the same row, so this stands until the row is removed.
			a.ctxLogger(r.Context()).Warn("achievement row names another user or achievement", "error", err)
			a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reasonBackendUnavailable}})
			return
		}
		if isTerminalCompletionError(err) {
			a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reasonBackendUnavailable}})
			return
		}
		a.ctxLogger(r.Context()).Debug("achievements unavailable", "reason", classifyGuideProxyError(err).Reason)
		w.Header().Set("Retry-After", strconv.Itoa(completionRetryAfterSeconds))
		a.writeProxyError(w, errAchievementsUnavailable, http.StatusServiceUnavailable, appPlatformDiagnostic(err, "achievementawards", "get"))
		return
	}

	a.writeMyAchievements(w, shapeMyAchievements(rows, defs))
}

func shapeMyAchievements(rows achievements.Rows, defs *achievements.Snapshot) myAchievementsResponse {
	return services.ShapeMyAchievements(rows, defs)
}

func (a *App) writeMyAchievements(w http.ResponseWriter, resp myAchievementsResponse) {
	if resp.Awards == nil {
		resp.Awards = []achievementAward{}
	}
	if resp.Progress == nil {
		resp.Progress = []achievementProgress{}
	}
	if resp.Legacy == nil {
		resp.Legacy = []legacyBadge{}
	}
	a.writeJSON(w, resp, http.StatusOK)
}

// writeAchievementsUnavailable is the structural 404: the client disarms for
// the session and keeps its queue.
func (a *App) writeAchievementsUnavailable(w http.ResponseWriter, reason, operation string) {
	a.writeProxyError(w, errAchievementsUnavailable, http.StatusNotFound,
		proxyGateDiagnostic(reason, "achievementawards", operation, "configuration"))
}
