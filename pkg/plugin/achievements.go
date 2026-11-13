package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/grafana/authlib/types"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
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

// achievementsBackendFor builds the backend for one request. An empty reason
// means available; otherwise the reason is the capability token.
type achievementsBackendFor func(r *http.Request) (achievementsBackend, string)

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

type achievementEventsResponse struct {
	EventID   string                  `json:"eventId"`
	Retry     bool                    `json:"retry"`
	Decisions []achievements.Decision `json:"decisions"`
}

type achievementCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type achievementAward struct {
	AchievementID string `json:"achievementId"`
	TierID        string `json:"tierId"`
	Entity        string `json:"entity"`
	EarnedAt      string `json:"earnedAt"`
}

type achievementProgress struct {
	AchievementID string `json:"achievementId"`
	Units         int    `json:"units"`
	Next          *int   `json:"next"`
}

type legacyBadge struct {
	Source     string `json:"source"`
	Name       string `json:"name"`
	AcquiredAt string `json:"acquiredAt,omitempty"`
}

type myAchievementsResponse struct {
	AsOf string `json:"asOf,omitempty"`
	// A change tells the client to refetch /definitions.
	DefinitionsVersion string                `json:"definitionsVersion,omitempty"`
	Capability         achievementCapability `json:"capability"`
	Truncated          bool                  `json:"truncated"`
	Awards             []achievementAward    `json:"awards"`
	Progress           []achievementProgress `json:"progress"`
	Legacy             []legacyBadge         `json:"legacy"`
}

// resolveAchievementsBackend applies the completion routes' structural gate,
// then asks the configured backend builder. Until one is configured the routes
// report themselves unavailable.
func (a *App) resolveAchievementsBackend(r *http.Request) (achievementsBackend, string) {
	if _, _, _, ok, reason := a.resolveCompletionConfig(r); !ok {
		return achievementsBackend{}, reason
	}
	if a.definitions == nil || a.achievementsBackendFor == nil {
		return achievementsBackend{}, reasonBackendUnavailable
	}
	backend, reason := a.achievementsBackendFor(r)
	if reason != "" {
		return achievementsBackend{}, reason
	}
	return backend, ""
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

	backend, reason := a.resolveAchievementsBackend(r)
	if reason != "" {
		a.writeAchievementsUnavailable(w, reason, "create")
		return
	}
	defs, ok := a.achievementDefinitions(w, r)
	if !ok {
		return
	}

	req, err := decodeAchievementEvent(w, r)
	if err != nil {
		a.writeError(w, "invalid-event", http.StatusBadRequest)
		return
	}
	event, err := defs.Registry.NewEvent(req, timeNow())
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

	backend, reason := a.resolveAchievementsBackend(r)
	if reason != "" {
		a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reason}})
		return
	}
	defs, ok := a.achievementDefinitions(w, r)
	if !ok {
		return
	}

	rows, err := backend.reader.ListMine(r.Context(), person)
	if err != nil {
		if isTerminalCompletionError(err) {
			a.writeMyAchievements(w, myAchievementsResponse{Capability: achievementCapability{Reason: reasonBackendUnavailable}})
			return
		}
		a.ctxLogger(r.Context()).Debug("achievements unavailable", "reason", classifyGuideProxyError(err).Reason)
		w.Header().Set("Retry-After", strconv.Itoa(completionRetryAfterSeconds))
		a.writeProxyError(w, errAchievementsUnavailable, http.StatusServiceUnavailable, appPlatformDiagnostic(err, "achievementawards", "list"))
		return
	}

	a.writeMyAchievements(w, shapeMyAchievements(rows, defs))
}

func shapeMyAchievements(rows achievements.Rows, defs *achievements.Snapshot) myAchievementsResponse {
	catalog := defs.Catalog
	resp := myAchievementsResponse{
		DefinitionsVersion: defs.Version,
		Capability:         achievementCapability{Available: true},
		Truncated:          rows.Truncated,
		Awards:             make([]achievementAward, 0, len(rows.Awards)),
		Progress:           make([]achievementProgress, 0, len(rows.Progress)),
	}
	if !rows.AsOf.IsZero() {
		resp.AsOf = rows.AsOf.UTC().Format(time.RFC3339)
	}
	for _, aw := range rows.Awards {
		resp.Awards = append(resp.Awards, achievementAward{
			AchievementID: aw.AchievementID,
			TierID:        aw.TierID,
			Entity:        aw.Entity,
			EarnedAt:      aw.EarnedAt.UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(resp.Awards, func(i, j int) bool {
		x, y := resp.Awards[i], resp.Awards[j]
		if x.AchievementID != y.AchievementID {
			return x.AchievementID < y.AchievementID
		}
		return awardBefore(catalog, x, y)
	})
	for _, p := range rows.Progress {
		next, counted := catalog.NextAt(p.AchievementID, p.TierIDs)
		if !counted {
			continue
		}
		resp.Progress = append(resp.Progress, achievementProgress{
			AchievementID: p.AchievementID,
			Units:         len(p.Units),
			Next:          next,
		})
	}
	sort.Slice(resp.Progress, func(i, j int) bool { return resp.Progress[i].AchievementID < resp.Progress[j].AchievementID })
	return resp
}

// awardBefore orders by catalog rank; a tier id the catalog lacks sorts last.
func awardBefore(catalog *achievements.Catalog, x, y achievementAward) bool {
	xr, xok := catalog.TierRank(x.AchievementID, x.TierID)
	yr, yok := catalog.TierRank(y.AchievementID, y.TierID)
	switch {
	case xok && yok:
		return xr < yr
	case xok != yok:
		return xok
	default:
		return x.TierID < y.TierID
	}
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
