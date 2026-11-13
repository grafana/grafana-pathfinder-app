package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

func completionWriteHandler(store services.CompletionRecordUpdater, syncAssignments func(context.Context, string, services.CompletionRecord)) simple.AppCustomRouteHandler {
	limiter := services.NewUserRateLimiter(20, 1, time.Now)
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(status int, message string) error {
			w.WriteHeader(status)
			return json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if req.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		caller, err := completionCaller(ctx, req.ResourceIdentifier.Namespace)
		if err != nil {
			return fail(http.StatusUnauthorized, "unauthenticated")
		}
		if allowed, retry := limiter.Allow(caller.Namespace + "\x00" + caller.Subject); !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(retry.Seconds())))))
			return fail(http.StatusTooManyRequests, "rate-limited")
		}
		if req.Body == nil {
			return fail(http.StatusBadRequest, "invalid request body")
		}
		var fact services.CompletionWriteRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 64*1024))
		if decoder.Decode(&fact) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			return fail(http.StatusBadRequest, "invalid request body")
		}
		spec, err := services.BuildCompletionSpec(fact, caller.Subject, caller.Login, caller.DisplayName, caller.Namespace, caller.OrgID, time.Now(), log.DefaultLogger)
		if err != nil {
			return fail(http.StatusBadRequest, err.Error())
		}
		name := ""
		status := http.StatusCreated
		persisted := spec
		invalidate := true
		if fact.AttemptID != "" {
			spec.AttemptStartedAt = fact.AttemptStartedAt
			if spec.AttemptStartedAt == "" {
				spec.AttemptStartedAt = fact.CompletedAt
			}
			incoming := services.AttemptWriteSpec(spec)
			name = services.CompletionAttemptRecordName(caller.Subject, fact.AttemptID)
			var outcome services.AttemptOutcome
			outcome, persisted, err = services.UpsertCompletionAttempt(ctx, store, caller.Namespace, name, incoming, func(err error) (int, string) {
				var upstream apierrors.APIStatus
				if errors.As(err, &upstream) {
					return int(upstream.Status().Code), string(upstream.Status().Reason)
				}
				return 0, ""
			})
			switch {
			case errors.Is(err, services.ErrAttemptIdentityMismatch):
				return fail(http.StatusConflict, "attempt-conflict")
			case errors.Is(err, services.ErrAttemptContended):
				w.Header().Set("Retry-After", "30")
				return fail(http.StatusServiceUnavailable, "completion-write-contended")
			case err != nil && incoming.CompletionPercent < 100 && completionSchemaNotReady(err):
				w.Header().Set("Retry-After", "30")
				return fail(http.StatusServiceUnavailable, "schema-not-ready")
			}
			if outcome != services.AttemptCreated {
				status = http.StatusOK
			}
			invalidate = outcome != services.AttemptUnchanged || persisted.CompletedAt != ""
		} else {
			name, err = services.CreateCompletion(ctx, store, caller.Namespace, spec, fact.IdempotencyKey, func(err error) bool { return sdkErrorStatus(err) == http.StatusConflict })
		}
		if err != nil {
			return writeCompletionSDKError(w, err)
		}
		if invalidate {
			services.InvalidateCompletionIndex(caller.Namespace)
		}
		if persisted.CompletedAt != "" {
			syncAssignments(context.WithoutCancel(ctx), caller.Namespace, services.CompletionRecord{UserID: persisted.UserID, GuideID: persisted.GuideID, GuideSource: persisted.GuideSource, GuideTitle: persisted.GuideTitle, GuideCategory: persisted.GuideCategory, PathID: persisted.PathID, Source: persisted.Source, CompletedAt: persisted.CompletedAt, CompletionPercent: persisted.CompletionPercent})
		}
		w.WriteHeader(status)
		return json.NewEncoder(w).Encode(map[string]string{"name": name})
	}
}

func completionSchemaNotReady(err error) bool {
	var upstream apierrors.APIStatus
	if !errors.As(err, &upstream) {
		return false
	}
	status := upstream.Status()
	if status.Code != 422 || status.Reason != "Invalid" || status.Details == nil || len(status.Details.Causes) == 0 {
		return false
	}
	for _, cause := range status.Details.Causes {
		if cause.Field != "spec.completedAt" || cause.Type != "FieldValueRequired" {
			return false
		}
	}
	return true
}

func writeCompletionSDKError(w app.CustomRouteResponseWriter, err error) error {
	diagnostic := upstreamDiagnostic(err, "completionrecords", "create")
	status := diagnostic.UpstreamStatus
	message := "completion-write-rejected"
	if status == 0 || status == 408 || status == 429 || status >= 500 || status < 400 {
		message = "completion-write-unavailable"
		retry := 30
		if seconds, ok := apierrors.SuggestsClientDelay(err); ok {
			retry = seconds
		}
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		if status == 0 {
			status = http.StatusServiceUnavailable
		} else if status < 400 {
			status = http.StatusBadGateway
		}
	}
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(struct {
		Error       string                   `json:"error"`
		Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
	}{message, *diagnostic})
}
