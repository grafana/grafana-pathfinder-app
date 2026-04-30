package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Role values reported by Grafana on backend.User.Role. Compared as
// plain strings because backend.User.Role is itself a string and these
// are the only values Grafana emits today.
const (
	roleEditor = "Editor"
	roleAdmin  = "Admin"
)

// importKindInteractiveGuide is the only `kind` the v1 import endpoint
// accepts. Reserved for future kinds (e.g. GuideCompletion) without
// needing a path-version bump.
const importKindInteractiveGuide = "InteractiveGuide"

// guidesImportRequest is the body shape accepted by
// POST /v1/guides/import.
//
// Spec stays as RawMessage: the K8s aggregator validates it server-side
// against the CUE schema in grafana-pathfinder-backend; we only peek at
// id/title for slug derivation and never re-validate.
type guidesImportRequest struct {
	Kind      string          `json:"kind"`
	Spec      json.RawMessage `json:"spec"`
	Overwrite bool            `json:"overwrite"`
}

// guidesImportSpecForSlug is the minimal subset of spec we read in Go
// to derive the resource name. The rest of the spec is opaque to us.
type guidesImportSpecForSlug struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// guidesImportResponse is the JSON returned on success.
//
// Created is true when a new resource was added, false when an existing
// resource was updated via overwrite. Status echoes spec.status from
// the persisted resource so callers can confirm the publication state.
type guidesImportResponse struct {
	Created         bool   `json:"created"`
	ResourceName    string `json:"resourceName"`
	Namespace       string `json:"namespace"`
	ResourceVersion string `json:"resourceVersion"`
	Status          string `json:"status,omitempty"`
}

var (
	nonSlugChars   = regexp.MustCompile(`[^a-z0-9-]+`)
	collapseDashes = regexp.MustCompile(`-+`)
)

// slugifyGuideName mirrors the rule used by the editor frontend at
// src/components/block-editor/hooks/useBackendGuides.ts:110-116 so
// resource names match between editor saves and API imports.
func slugifyGuideName(s string) string {
	s = strings.ToLower(s)
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = collapseDashes.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// requireGuidesWriter rejects requests from users who lack the Editor
// or Admin role. The role granted to a user is derived by Grafana from
// the pathfinder-app.guides:write action declared in plugin.json
// (Interactive learning Writer / Interactive learning Admin), but the
// manifest alone is decorative — handlers must enforce.
func requireGuidesWriter(user *backend.User) error {
	if user == nil {
		return apiError{code: http.StatusUnauthorized, msg: "missing user context"}
	}
	switch user.Role {
	case roleEditor, roleAdmin:
		return nil
	default:
		return apiError{code: http.StatusForbidden, msg: "this operation requires the Editor or Admin role"}
	}
}

// apiError is an internal error type the handler uses to short-circuit
// with a specific HTTP status. The handler entry point converts it into
// a writeError response.
type apiError struct {
	code int
	msg  string
}

func (e apiError) Error() string { return e.msg }

// handleGuidesImport is the POST /v1/guides/import handler.
//
// Flow: reject non-POST, decode body, role check, slug, existence
// check, then either Create (if 404) or Update (if exists + overwrite)
// or 409 (if exists + !overwrite). Namespace and AppURL are
// server-derived from the plugin context — never trusted from the
// request body.
func (a *App) handleGuidesImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	pluginCtx := backend.PluginConfigFromContext(r.Context())
	if err := requireGuidesWriter(pluginCtx.User); err != nil {
		var ae apiError
		if errors.As(err, &ae) {
			a.writeError(w, ae.msg, ae.code)
			return
		}
		a.writeError(w, err.Error(), http.StatusForbidden)
		return
	}

	if a.guidesClient == nil {
		a.writeError(w, "guides import is not configured on this Grafana instance", http.StatusServiceUnavailable)
		return
	}

	// Graceful fail for OSS / pre-rollout Cloud: the aggregator API is
	// only served when the feature toggle is on. Mirrors the frontend's
	// `isBackendApiAvailable` gate so callers see a clear 501 rather
	// than a 502 from a failed outbound call.
	if !isGuidesAggregatorEnabled(r.Context()) {
		a.writeError(
			w,
			"custom guide storage is not available on this Grafana instance; the import API requires the pathfinderbackend.ext.grafana.com aggregator (Grafana Cloud)",
			http.StatusNotImplemented,
		)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20)) // 1 MiB cap
	if err != nil {
		a.writeError(w, "request body too large or unreadable: "+err.Error(), http.StatusBadRequest)
		return
	}

	var ir guidesImportRequest
	if err := json.Unmarshal(body, &ir); err != nil {
		a.writeError(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if ir.Kind != importKindInteractiveGuide {
		a.writeError(w, fmt.Sprintf("kind must be %q", importKindInteractiveGuide), http.StatusBadRequest)
		return
	}
	if len(ir.Spec) == 0 {
		a.writeError(w, "spec is required", http.StatusBadRequest)
		return
	}

	var slugSrc guidesImportSpecForSlug
	if err := json.Unmarshal(ir.Spec, &slugSrc); err != nil {
		a.writeError(w, "spec must be a JSON object: "+err.Error(), http.StatusBadRequest)
		return
	}
	name := slugifyGuideName(slugSrc.ID)
	if name == "" {
		name = slugifyGuideName(slugSrc.Title)
	}
	if name == "" {
		a.writeError(w, "spec.id or spec.title must contain at least one alphanumeric character", http.StatusBadRequest)
		return
	}

	// Forward the caller's identity to the aggregator. Grafana strips
	// the inbound `Authorization` header before it reaches plugin
	// resource handlers, so we use `X-Grafana-Id` (the user's ID JWT)
	// instead — the same pattern grafana-slo-app uses
	// (`auth_handler_decorator.go:225`). Requires the `idForwarding`
	// Grafana feature toggle to be on so that Grafana populates the
	// header in the first place.
	idToken := r.Header.Get("X-Grafana-Id")
	rc, err := configFromRequest(r.Context(), pluginCtx.Namespace, idToken)
	if err != nil {
		a.logger.FromContext(r.Context()).Error("Guides aggregator config unavailable", "error", err)
		a.writeError(w, "guides aggregator unavailable: "+err.Error(), http.StatusBadGateway)
		return
	}

	resp, err := a.upsertGuide(r.Context(), rc, name, ir)
	if err != nil {
		a.writeImportError(w, r.Context(), name, err)
		return
	}
	a.writeJSON(w, resp, http.StatusOK)
}

// upsertGuide drives the existence check + create/update decision
// against the aggregator. Pure logic — no HTTP response writing —
// so the handler can stay focused on transport concerns.
func (a *App) upsertGuide(ctx context.Context, rc *guidesRequestConfig, name string, ir guidesImportRequest) (*guidesImportResponse, error) {
	existing, getErr := a.guidesClient.Get(ctx, rc, name)
	switch {
	case errors.Is(getErr, errGuideNotFound):
		// Fall through to create.
	case getErr != nil:
		return nil, getErr
	default:
		// Exists.
		if !ir.Overwrite {
			return nil, apiError{
				code: http.StatusConflict,
				msg:  fmt.Sprintf("guide %q already exists; pass overwrite=true to replace it", name),
			}
		}
		envelope := &guidesEnvelope{
			APIVersion: guidesAPIGroup + "/" + guidesAPIVersion,
			Kind:       guidesAPIKind,
			Metadata: guidesMetadata{
				Name:            name,
				Namespace:       rc.Namespace,
				ResourceVersion: existing.Metadata.ResourceVersion,
			},
			Spec: ir.Spec,
		}
		updated, err := a.guidesClient.Update(ctx, rc, envelope)
		if err != nil {
			return nil, err
		}
		return &guidesImportResponse{
			Created:         false,
			ResourceName:    name,
			Namespace:       rc.Namespace,
			ResourceVersion: updated.Metadata.ResourceVersion,
			Status:          updated.Spec.Status,
		}, nil
	}

	envelope := &guidesEnvelope{
		APIVersion: guidesAPIGroup + "/" + guidesAPIVersion,
		Kind:       guidesAPIKind,
		Metadata: guidesMetadata{
			Name:      name,
			Namespace: rc.Namespace,
		},
		Spec: ir.Spec,
	}
	created, err := a.guidesClient.Create(ctx, rc, envelope)
	if err != nil {
		return nil, err
	}
	return &guidesImportResponse{
		Created:         true,
		ResourceName:    name,
		Namespace:       rc.Namespace,
		ResourceVersion: created.Metadata.ResourceVersion,
		Status:          created.Spec.Status,
	}, nil
}

// writeImportError translates handler / client errors into HTTP
// responses with the right status. Closed set:
//
//   - apiError → echo its embedded code (used for 409, 401, 403, 4xx
//     produced by the handler itself).
//   - *k8sStatusError → bubble its Code (lets aggregator 422 / 503 /
//     etc. reach the caller with the original message).
//   - aggregator-unavailable signal → 502 BAD_GATEWAY.
//   - everything else → 500 with a generic message and a logged
//     traceID so operators can correlate.
func (a *App) writeImportError(w http.ResponseWriter, ctx context.Context, name string, err error) {
	var ae apiError
	if errors.As(err, &ae) {
		a.writeError(w, ae.msg, ae.code)
		return
	}
	var se *k8sStatusError
	if errors.As(err, &se) {
		if isAggregatorUnavailable(err) {
			a.writeError(w, "guides aggregator is not available on this stack", http.StatusBadGateway)
			return
		}
		a.writeError(w, se.Error(), se.statusCode())
		return
	}
	a.logger.FromContext(ctx).Error("Guides import failed", "name", name, "error", err)
	a.writeError(w, "internal error during guides import", http.StatusInternalServerError)
}
