package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

type AchievementDefinitions interface {
	Snapshot(context.Context) (*achievements.Snapshot, time.Duration)
}
type achievementPolicy struct {
	limiter   *services.UserRateLimiter
	namespace string
}
type achievementRateLimit struct{ retry time.Duration }

func (e *achievementRateLimit) Error() string { return "rate-limited" }
func (p achievementPolicy) Allow(_ context.Context, person achievements.Person) error {
	if ok, retry := p.limiter.Allow(p.namespace + "\x00" + person.ID); !ok {
		return &achievementRateLimit{retry: retry}
	}
	return nil
}

type achievementDefinitionsResponse = services.AchievementDefinitionsResponse

func achievementHandler(clients *resourceaccess.AchievementClients, definitions AchievementDefinitions, operation string) simple.AppCustomRouteHandler {
	limiter := services.NewUserRateLimiter(30, 0.5, time.Now)
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		write := func(status int, value any) error { w.WriteHeader(status); return json.NewEncoder(w).Encode(value) }
		fail := func(status int, reason string) error { return write(status, map[string]string{"error": reason}) }
		unavailable := func(reason string) error {
			return write(200, services.MyAchievementsResponse{Capability: services.AchievementCapability{Reason: reason}, Awards: []services.AchievementAward{}, Progress: []services.AchievementProgress{}, Legacy: []services.LegacyBadge{}})
		}
		method := http.MethodGet
		if operation == "events" {
			method = http.MethodPost
		}
		if req.Method != method {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		caller, err := completionCaller(ctx, req.ResourceIdentifier.Namespace)
		if err != nil {
			if operation == "my" {
				return unavailable("identity-unavailable")
			}
			return fail(completionCallerFailure(err))
		}
		principal, _, err := authlib.ParseTypeID(caller.Subject)
		if err != nil || principal != authlib.TypeUser {
			if operation == "my" {
				return unavailable("principal-not-supported")
			}
			return fail(403, "principal-not-supported")
		}
		if definitions == nil {
			if operation == "my" {
				return unavailable("backend-unavailable")
			}
			return fail(404, "achievements-unavailable")
		}
		defs, retry := definitions.Snapshot(ctx)
		if defs == nil {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int((retry+time.Second-1)/time.Second))))
			return fail(503, "definitions-unavailable")
		}
		person := achievements.Person{ID: caller.Subject}
		store := services.NewAchievementStore(clients, services.AchievementWriter{Namespace: caller.Namespace, OrgID: caller.OrgID, UserLogin: caller.Login, UserDisplayName: caller.DisplayName}, time.Now, log.DefaultLogger)
		switch operation {
		case "definitions":
			stack := achievements.Stack{}
			if req.URL != nil {
				stack.GrafanaVersion = req.URL.Query().Get("grafanaVersion")
			}
			return write(200, achievementDefinitionsResponse{Version: defs.Version, ArtBase: "https://interactive-learning.grafana.net/achievements/art/", Achievements: append([]achievements.Display{}, defs.DisplayFor(stack)...), Sources: defs.Registry.Subscriptions(stack)})
		case "my":
			rows, err := (&services.AchievementReader{Store: store, Catalog: defs.Catalog, Now: time.Now}).ListMine(ctx, person)
			if err != nil {
				status := sdkErrorStatus(err)
				if status >= 400 && status < 500 && status != 429 {
					return unavailable("backend-unavailable")
				}
				w.Header().Set("Retry-After", "30")
				return write(503, struct {
					Error       string                    `json:"error"`
					Diagnostics *services.ProxyDiagnostic `json:"diagnostics,omitempty"`
				}{"achievements-unavailable", upstreamDiagnostic(err, "achievementawards", "get")})
			}
			result := services.ShapeMyAchievements(rows, defs)
			result.Legacy = []services.LegacyBadge{}
			return write(200, result)
		case "events":
			if req.Body == nil {
				return fail(400, "invalid-event")
			}
			var request achievements.EventRequest
			decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 4096))
			if decoder.Decode(&request) != nil || decoder.Decode(&struct{}{}) != io.EOF {
				return fail(400, "invalid-event")
			}
			event, err := defs.Registry.NewEvent(request, time.Now())
			if errors.Is(err, achievements.ErrNotCounted) {
				return write(http.StatusOK, services.AchievementEventsResponse{EventID: request.EventID, Decisions: []achievements.Decision{}})
			}
			if err != nil {
				return fail(400, "invalid-event")
			}
			ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			decisions, err := achievements.NewEvaluator(defs.Catalog, store, achievementPolicy{limiter: limiter, namespace: caller.Namespace}, time.Now).Evaluate(ctx, person, event)
			var limited *achievementRateLimit
			if errors.As(err, &limited) {
				w.Header().Set("Retry-After", strconv.Itoa(max(1, int((limited.retry+time.Second-1)/time.Second))))
				return fail(429, "rate-limited")
			}
			if err != nil {
				return fail(503, "busy")
			}
			return write(200, services.AchievementEventsResponse{EventID: event.ID, Retry: achievements.Retry(decisions), Decisions: decisions})
		default:
			return fail(404, "not found")
		}
	}
}
